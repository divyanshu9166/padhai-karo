/**
 * Razorpay webhook handler (task 16.3; design "Razorpay Webhook Verification"; Req 9.5).
 *
 * `POST /api/webhooks/razorpay` is the ONLY endpoint that mutates state without a user
 * session. It is authenticated instead by the Razorpay webhook signature: the
 * `X-Razorpay-Signature` header is an HMAC-SHA256 of the RAW request body under the
 * configured webhook secret. We verify that HMAC over the exact raw bytes BEFORE acting;
 * a missing/invalid signature is rejected with `400` and no state is touched.
 *
 * The payload is treated as UNTRUSTED: its structure is validated defensively and any
 * event type we do not recognize is acknowledged with `200` without acting. For a
 * recognized capture event (`payment.captured` / `order.paid`) we map the event to the
 * local `Payment` (by Razorpay order id), ensure it is marked `CAPTURED`, and run the
 * shared {@link runBillingReconcile}. Because reconciliation is idempotent by payment id,
 * the webhook safely confirms/applies the tier upgrade (or refund-on-failure) whether it
 * arrives before, after, or instead of `POST /subscriptions/verify`, and Razorpay's
 * at-least-once delivery never double-applies.
 *
 * Signature verification is intentionally separated from the Next.js route: the handler
 * receives the raw body string and the header value, so it is fully unit-testable with a
 * mocked Prisma/gateway and an explicit secret — no live network, DB, or Redis.
 */
import { prisma } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { RazorpayHttpGateway } from './razorpayGateway';
import { runBillingReconcile, type ReconcilePrisma } from './reconcile';
import { verifyHmacSignature } from './signature';
import type { RazorpayGateway } from './types';

/** Event types we act on; any other recognized/unrecognized type is acknowledged only. */
const CAPTURE_EVENTS: ReadonlySet<string> = new Set(['payment.captured', 'order.paid']);

/** The persisted payment fields the webhook reads when mapping an event to a local row. */
export interface WebhookPaymentRow {
    id: string;
    status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
    razorpayPaymentId: string | null;
}

/**
 * The narrow slice of Prisma the webhook itself uses: locate the local payment by Razorpay
 * order id and stamp it `CAPTURED`. Declared structurally so tests pass a lightweight mock
 * (the same object also satisfies {@link ReconcilePrisma} for the reconciliation call).
 */
export interface WebhookPrisma {
    payment: {
        findFirst(args: {
            where: { razorpayOrderId: string };
        }): Promise<WebhookPaymentRow | null>;
        update(args: {
            where: { id: string };
            data: { status: 'CAPTURED'; razorpayPaymentId: string };
        }): Promise<unknown>;
    };
}

/** Dependencies for {@link handleRazorpayWebhook}. */
export interface WebhookDeps {
    prisma: WebhookPrisma;
    gateway: RazorpayGateway;
    /** The Razorpay webhook signing secret the HMAC is verified against. */
    webhookSecret: string;
}

/** A success acknowledgement. Razorpay only needs a 2xx to stop retrying. */
function acknowledge(): Response {
    return Response.json({ received: true }, { status: 200 });
}

/** Narrow an unknown to a plain object, or `undefined` for non-objects/null/arrays. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

/** Return `value` when it is a non-empty string, else `undefined`. */
function asNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Defensively pull the Razorpay order id and payment id out of an (untrusted) event. The
 * order id is taken from `payload.payment.entity.order_id`, falling back to
 * `payload.order.entity.id`; the payment id from `payload.payment.entity.id`.
 */
function extractRefs(event: unknown): { orderId?: string; razorpayPaymentId?: string } {
    const payload = asRecord(asRecord(event)?.payload);
    const paymentEntity = asRecord(asRecord(payload?.payment)?.entity);
    const orderEntity = asRecord(asRecord(payload?.order)?.entity);

    const orderId =
        asNonEmptyString(paymentEntity?.order_id) ?? asNonEmptyString(orderEntity?.id);
    const razorpayPaymentId = asNonEmptyString(paymentEntity?.id);

    return { orderId, razorpayPaymentId };
}

/**
 * Verify and process a Razorpay webhook delivery.
 *
 * @param rawBody - the EXACT raw request body string the signature was computed over.
 *                  It must not be re-serialized; verification uses these bytes verbatim.
 * @param signatureHeader - the `X-Razorpay-Signature` header value (or `null` if absent).
 * @returns `400` for a missing/invalid signature or malformed body (no state change);
 *          otherwise `200` after acting on a recognized event or acknowledging others.
 */
export async function handleRazorpayWebhook(
    rawBody: string,
    signatureHeader: string | null,
    deps: WebhookDeps,
): Promise<Response> {
    // 1. Authenticate by signature over the RAW body BEFORE touching any state.
    const signature = asNonEmptyString(signatureHeader);
    if (signature === undefined) {
        return errorResponse(400, ErrorCode.VALIDATION_ERROR, 'Missing webhook signature.');
    }
    if (!verifyHmacSignature(rawBody, signature, deps.webhookSecret)) {
        return errorResponse(400, ErrorCode.VALIDATION_ERROR, 'Invalid webhook signature.');
    }

    // 2. Parse the now-trusted-origin body. A malformed body is rejected (no state change).
    let event: unknown;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return errorResponse(400, ErrorCode.VALIDATION_ERROR, 'Malformed webhook payload.');
    }

    // 3. Ignore unrecognized event types — acknowledge without acting.
    const eventType = asNonEmptyString(asRecord(event)?.event);
    if (eventType === undefined || !CAPTURE_EVENTS.has(eventType)) {
        return acknowledge();
    }

    // 4. Map the event to the local Payment by Razorpay order id (defensive extraction).
    const { orderId, razorpayPaymentId } = extractRefs(event);
    if (orderId === undefined) {
        return acknowledge();
    }
    const payment = await deps.prisma.payment.findFirst({
        where: { razorpayOrderId: orderId },
    });
    if (payment === null) {
        return acknowledge();
    }

    // 5. Ensure the payment is CAPTURED (so reconciliation can apply the upgrade), then run
    //    the shared upgrade + compensation. Both steps are idempotent by payment id, so a
    //    redelivered or post-`/verify` webhook confirms rather than duplicates the upgrade.
    if (payment.status === 'CREATED' && razorpayPaymentId !== undefined) {
        await deps.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'CAPTURED', razorpayPaymentId },
        });
    }

    await runBillingReconcile(payment.id, {
        prisma: deps.prisma as unknown as ReconcilePrisma,
        gateway: deps.gateway,
    });

    return acknowledge();
}

/** Default live gateway; reused across requests (reads secrets lazily when invoked). */
const defaultGateway: RazorpayGateway = new RazorpayHttpGateway();

/**
 * Route-facing entry point. Reads the raw body and signature header from the request and
 * delegates to {@link handleRazorpayWebhook} with the live Prisma/gateway and the
 * configured webhook secret. The raw body is read via `request.text()` so the HMAC is
 * verified over the exact bytes Razorpay signed (never a re-serialized object).
 */
export async function razorpayWebhookHandler(request: Request): Promise<Response> {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get('x-razorpay-signature');

    return handleRazorpayWebhook(rawBody, signatureHeader, {
        prisma: prisma as unknown as WebhookPrisma,
        gateway: defaultGateway,
        webhookSecret: getConfig().razorpay.webhookSecret,
    });
}
