/**
 * Subscription service handlers (task 16.2; design "Monetization / Subscription Service",
 * "Subscription Upgrade with Compensating Refund"; Req 9.5, 9.6).
 *
 * Implements:
 *
 *   POST /api/subscriptions/order
 *     body: { plan }
 *     -> 201 { razorpayOrderId, amount }                                   (create order)
 *     -> 422 VALIDATION_ERROR (unknown/missing plan)
 *
 *   POST /api/subscriptions/verify
 *     body: { razorpayOrderId, razorpayPaymentId, signature }
 *     -> 200 { tier, aiQuota }   (valid signature + upgrade applied — Req 9.5)
 *     -> 402 PAYMENT_FAILED      (invalid signature, OR upgrade failed → refunded — Req 9.6)
 *     -> 404 NOT_FOUND           (no matching pending order for the user)
 *
 *   GET /api/subscriptions
 *     -> 200 { tier, aiQuota, payments[] }
 *
 * All handlers are guarded by `withAuth` at the route layer and scope every query to
 * `auth.user.id`. The Razorpay client is injected as a {@link RazorpayGateway} (defaulting
 * to {@link RazorpayHttpGateway}) so tests pass a mock and no live call runs. On a valid
 * signature the handler marks the payment CAPTURED and invokes the shared
 * {@link runBillingReconcile} (the same reusable upgrade+compensation the `billing-reconcile`
 * worker runs), so the request path and the worker path apply identical semantics.
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { getPlan } from './plans';
import { RazorpayHttpGateway } from './razorpayGateway';
import { runBillingReconcile, type ReconcilePrisma } from './reconcile';
import type { RazorpayGateway } from './types';

/** Default live gateway; constructed once and reused (reads secrets lazily when invoked). */
const defaultGateway: RazorpayGateway = new RazorpayHttpGateway();

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Handle `POST /api/subscriptions/order`. Validates the requested plan, creates a Razorpay
 * order via the gateway, persists a `Payment` row in the `CREATED` state, and returns the
 * order id + amount the client needs to launch checkout.
 */
export async function createOrderHandler(
    request: Request,
    auth: AuthContext,
    gateway: RazorpayGateway = defaultGateway,
): Promise<Response> {
    const body = await readJsonBody(request);
    const plan = getPlan((body as { plan?: unknown } | undefined)?.plan);
    if (plan === undefined) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'A valid subscription plan is required.',
            { field: 'plan' },
        );
    }

    const order = await gateway.createOrder({
        amount: plan.amount,
        currency: plan.currency,
        notes: { userId: auth.user.id, plan: plan.id },
    });

    await prisma.payment.create({
        data: {
            userId: auth.user.id,
            razorpayOrderId: order.id,
            amount: plan.amount,
            status: 'CREATED',
        },
    });

    return Response.json({ razorpayOrderId: order.id, amount: plan.amount }, { status: 201 });
}

/**
 * Handle `POST /api/subscriptions/verify`. Verifies the Razorpay payment signature; on an
 * invalid signature marks the pending payment FAILED and returns 402 with no tier change.
 * On a valid signature marks the payment CAPTURED, then runs the shared upgrade +
 * compensation (Req 9.5/9.6): success returns the new tier + quota; a failed upgrade is
 * refunded with the tier left unchanged and surfaces as 402.
 */
export async function verifyPaymentHandler(
    request: Request,
    auth: AuthContext,
    gateway: RazorpayGateway = defaultGateway,
): Promise<Response> {
    const body = (await readJsonBody(request)) as
        | { razorpayOrderId?: unknown; razorpayPaymentId?: unknown; signature?: unknown }
        | undefined;

    const razorpayOrderId = body?.razorpayOrderId;
    const razorpayPaymentId = body?.razorpayPaymentId;
    const signature = body?.signature;
    if (
        typeof razorpayOrderId !== 'string' ||
        typeof razorpayPaymentId !== 'string' ||
        typeof signature !== 'string'
    ) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'razorpayOrderId, razorpayPaymentId, and signature are required.',
        );
    }

    // Locate the user's pending order. Scoping by userId enforces per-user isolation.
    const payment = await prisma.payment.findFirst({
        where: { userId: auth.user.id, razorpayOrderId, status: 'CREATED' },
    });
    if (payment === null) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'No pending payment found for the given order.',
        );
    }

    // Verify the HMAC signature. Invalid → 402, mark FAILED, leave the tier unchanged.
    const valid = gateway.verifyPaymentSignature({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature });
    if (!valid) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
        return errorResponse(
            402,
            ErrorCode.PAYMENT_FAILED,
            'Payment signature verification failed.',
        );
    }

    // Valid signature → mark CAPTURED, then run the shared upgrade + compensation path.
    await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'CAPTURED', razorpayPaymentId },
    });

    const result = await runBillingReconcile(payment.id, {
        prisma: prisma as unknown as ReconcilePrisma,
        gateway,
    });

    if (result.outcome === 'UPGRADED' || result.outcome === 'ALREADY_UPGRADED') {
        return Response.json({ tier: result.tier, aiQuota: result.aiQuota }, { status: 200 });
    }

    // Upgrade failed after capture → refunded, tier unchanged (Req 9.6).
    return errorResponse(
        402,
        ErrorCode.PAYMENT_FAILED,
        'Subscription upgrade failed after payment; the payment was refunded.',
    );
}

/**
 * Handle `GET /api/subscriptions`. Returns the authenticated user's current tier, remaining
 * AI quota, and payment history (newest first). Scoped to `auth.user.id`.
 */
export async function getSubscriptionHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const userId = auth.user.id;

    const profile = await prisma.profile.findUnique({
        where: { userId },
        select: { subscriptionTier: true, aiQuota: true },
    });
    if (profile === null) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'No profile found for the user. Complete onboarding first.',
        );
    }

    const payments = await prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
    });

    return Response.json({
        tier: profile.subscriptionTier,
        aiQuota: profile.aiQuota,
        payments,
    });
}
