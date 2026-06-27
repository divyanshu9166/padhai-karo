/**
 * Post-payment upgrade transaction and refund-on-failure compensation (task 16.2;
 * design "Subscription Upgrade with Compensating Refund", "Payment Failures &
 * Refund-on-Upgrade-Failure"; Req 9.5, 9.6).
 *
 * {@link runBillingReconcile} is the single reusable function that both the
 * `POST /subscriptions/verify` handler and the `billing-reconcile` BullMQ worker invoke.
 * Keeping the upgrade + compensation in one place means the request path and the
 * retryable/decoupled worker path apply identical, consistent semantics.
 *
 * Behaviour for a CAPTURED payment:
 *   1. Run the upgrade as a single transaction: set `Profile.subscriptionTier = PAID`,
 *      allocate the plan's `aiQuota`, upsert `Subscription { tier: PAID }`, and stamp the
 *      payment with its `subscriptionId` (Req 9.5).
 *   2. If the transaction fails, issue a Razorpay refund, mark the payment `REFUNDED`, and
 *      leave the tier unchanged (Req 9.6).
 *
 * Idempotency is keyed by payment id so the worker can retry with backoff without
 * double-applying or double-refunding:
 *   - a payment already stamped with a `subscriptionId` is treated as ALREADY_UPGRADED;
 *   - a payment already `REFUNDED` is treated as ALREADY_REFUNDED (no second refund);
 *   - a payment not in a `CAPTURED` state is a NOOP (nothing to reconcile yet).
 */
import { getPlanByAmount } from './plans';
import type { RazorpayGateway } from './types';

/** The persisted payment fields the reconciliation reads. */
export interface ReconcilePaymentRow {
    id: string;
    userId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string | null;
    amount: number;
    status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
    subscriptionId: string | null;
}

/** The transaction-scoped client used inside the upgrade transaction. */
export interface ReconcileTx {
    subscription: {
        upsert(args: {
            where: { userId: string };
            create: { userId: string; tier: 'PAID' };
            update: { tier: 'PAID' };
        }): Promise<{ id: string }>;
    };
    profile: {
        update(args: {
            where: { userId: string };
            data: { subscriptionTier: 'PAID'; aiQuota: number };
        }): Promise<{ subscriptionTier: 'PAID' | 'FREE'; aiQuota: number }>;
    };
    payment: {
        update(args: {
            where: { id: string };
            data: { subscriptionId: string };
        }): Promise<unknown>;
    };
}

/**
 * The narrow slice of Prisma the reconciliation needs. Declared structurally so tests pass
 * a lightweight mock while the real `PrismaClient` satisfies the same shape.
 */
export interface ReconcilePrisma {
    payment: {
        findUnique(args: {
            where: { id: string };
        }): Promise<ReconcilePaymentRow | null>;
        update(args: {
            where: { id: string };
            data: { status: 'REFUNDED' };
        }): Promise<unknown>;
    };
    $transaction<T>(fn: (tx: ReconcileTx) => Promise<T>): Promise<T>;
}

/** Dependencies for {@link runBillingReconcile}. */
export interface ReconcileDeps {
    prisma: ReconcilePrisma;
    gateway: RazorpayGateway;
}

/** The terminal outcome of a reconciliation pass, useful for the response and logging. */
export type ReconcileOutcome =
    | { outcome: 'UPGRADED'; tier: 'PAID'; aiQuota: number }
    | { outcome: 'ALREADY_UPGRADED'; tier: 'PAID'; aiQuota: number }
    | { outcome: 'REFUNDED' }
    | { outcome: 'ALREADY_REFUNDED' }
    | { outcome: 'NOOP'; reason: string };

/**
 * Apply the upgrade for a captured payment, compensating with a refund if the upgrade
 * transaction fails. Idempotent by payment id (see module docs).
 *
 * @param paymentId - the local `Payment.id` to reconcile.
 */
export async function runBillingReconcile(
    paymentId: string,
    deps: ReconcileDeps,
): Promise<ReconcileOutcome> {
    const { prisma } = deps;

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (payment === null) {
        return { outcome: 'NOOP', reason: 'payment-not-found' };
    }

    // Idempotency guards — safe to re-run for the same payment id.
    if (payment.status === 'REFUNDED') {
        return { outcome: 'ALREADY_REFUNDED' };
    }
    if (payment.subscriptionId !== null) {
        // The upgrade already committed (payment stamped with its subscription).
        const plan = getPlanByAmount(payment.amount);
        return { outcome: 'ALREADY_UPGRADED', tier: 'PAID', aiQuota: plan?.aiQuota ?? 0 };
    }
    if (payment.status !== 'CAPTURED') {
        // Not yet captured (or already failed) — nothing to reconcile.
        return { outcome: 'NOOP', reason: `unexpected-status:${payment.status}` };
    }

    const plan = getPlanByAmount(payment.amount);
    if (plan === undefined) {
        // No plan matches the captured amount; we cannot allocate quota safely → refund.
        return refund(payment, deps, 'unknown-plan');
    }

    try {
        const aiQuota = await prisma.$transaction(async (tx) => {
            const subscription = await tx.subscription.upsert({
                where: { userId: payment.userId },
                create: { userId: payment.userId, tier: 'PAID' },
                update: { tier: 'PAID' },
            });
            const updatedProfile = await tx.profile.update({
                where: { userId: payment.userId },
                data: { subscriptionTier: 'PAID', aiQuota: plan.aiQuota },
            });
            // Stamp the payment with its subscription so a retry sees ALREADY_UPGRADED.
            await tx.payment.update({
                where: { id: payment.id },
                data: { subscriptionId: subscription.id },
            });
            return updatedProfile.aiQuota;
        });

        return { outcome: 'UPGRADED', tier: 'PAID', aiQuota };
    } catch {
        // Req 9.6: the upgrade failed after capture → refund and leave the tier unchanged.
        return refund(payment, deps, 'upgrade-failed');
    }
}

/**
 * Compensation step: refund the captured payment via Razorpay and mark it `REFUNDED`,
 * leaving the profile tier and quota untouched (Req 9.6). The refund call precedes the
 * status update; the ALREADY_REFUNDED guard plus a provider that is idempotent per payment
 * id prevent a double refund on retry.
 */
async function refund(
    payment: ReconcilePaymentRow,
    deps: ReconcileDeps,
    _reason: string,
): Promise<ReconcileOutcome> {
    const { prisma, gateway } = deps;

    if (payment.razorpayPaymentId !== null) {
        await gateway.refund({ paymentId: payment.razorpayPaymentId, amount: payment.amount });
    }
    await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED' },
    });

    return { outcome: 'REFUNDED' };
}
