import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SUBSCRIPTION_PLANS } from './plans';
import {
    runBillingReconcile,
    type ReconcileDeps,
    type ReconcilePaymentRow,
    type ReconcilePrisma,
} from './reconcile';
import type { RazorpayGateway } from './types';

/**
 * DB/Redis/network-independent tests for the reusable upgrade + compensation function
 * (task 16.2; Req 9.5, 9.6). A mocked Prisma and a mocked RazorpayGateway are injected, so
 * no live database or Razorpay call runs.
 *
 * Covers:
 *   - successful upgrade: tier PAID + plan quota allocated, subscription stamped (Req 9.5)
 *   - compensation: upgrade-transaction failure → refund issued, tier UNCHANGED, payment
 *     marked REFUNDED (Req 9.6)
 *   - idempotency keyed by payment id: an already-upgraded payment is a NOOP upgrade and an
 *     already-refunded payment is never refunded twice
 */
const MONTHLY = SUBSCRIPTION_PLANS.monthly;

function capturedPayment(overrides: Partial<ReconcilePaymentRow> = {}): ReconcilePaymentRow {
    return {
        id: 'pay-1',
        userId: 'user-1',
        razorpayOrderId: 'order_1',
        razorpayPaymentId: 'rzp_pay_1',
        amount: MONTHLY.amount,
        status: 'CAPTURED',
        subscriptionId: null,
        ...overrides,
    };
}

// --- Mocks -------------------------------------------------------------------
const findUniquePayment = vi.fn();
const updatePayment = vi.fn();
const upsertSubscription = vi.fn();
const updateProfile = vi.fn();
const txUpdatePayment = vi.fn();
const refund = vi.fn();
const verifyPaymentSignature = vi.fn();
const createOrder = vi.fn();

/** Build a mock ReconcilePrisma whose $transaction runs the callback against tx spies. */
function buildPrisma(opts: { profileUpdateThrows?: boolean } = {}): ReconcilePrisma {
    const tx = {
        subscription: { upsert: upsertSubscription },
        profile: {
            update: opts.profileUpdateThrows
                ? vi.fn(async () => {
                    throw new Error('profile update failed');
                })
                : updateProfile,
        },
        payment: { update: txUpdatePayment },
    };
    return {
        payment: { findUnique: findUniquePayment, update: updatePayment },
        $transaction: (async (fn: (t: typeof tx) => unknown) => fn(tx)) as ReconcilePrisma['$transaction'],
    };
}

function gateway(): RazorpayGateway {
    return { createOrder, verifyPaymentSignature, refund };
}

function deps(prisma: ReconcilePrisma): ReconcileDeps {
    return { prisma, gateway: gateway() };
}

beforeEach(() => {
    findUniquePayment.mockReset();
    updatePayment.mockReset();
    upsertSubscription.mockReset();
    updateProfile.mockReset();
    txUpdatePayment.mockReset();
    refund.mockReset();
    verifyPaymentSignature.mockReset();
    createOrder.mockReset();
});

describe('runBillingReconcile — successful upgrade (Req 9.5)', () => {
    it('sets tier PAID, allocates the plan quota, and stamps the subscription', async () => {
        findUniquePayment.mockResolvedValue(capturedPayment());
        upsertSubscription.mockResolvedValue({ id: 'sub-1' });
        updateProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: MONTHLY.aiQuota });

        const result = await runBillingReconcile('pay-1', deps(buildPrisma()));

        expect(result).toEqual({ outcome: 'UPGRADED', tier: 'PAID', aiQuota: MONTHLY.aiQuota });
        expect(upsertSubscription).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            create: { userId: 'user-1', tier: 'PAID' },
            update: { tier: 'PAID' },
        });
        expect(updateProfile).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            data: { subscriptionTier: 'PAID', aiQuota: MONTHLY.aiQuota },
        });
        // Payment stamped with its subscription id (idempotency marker).
        expect(txUpdatePayment).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { subscriptionId: 'sub-1' },
        });
        // No refund on the success path.
        expect(refund).not.toHaveBeenCalled();
    });
});

describe('runBillingReconcile — compensation on upgrade failure (Req 9.6)', () => {
    it('refunds, marks the payment REFUNDED, and leaves the tier unchanged', async () => {
        findUniquePayment.mockResolvedValue(capturedPayment());
        upsertSubscription.mockResolvedValue({ id: 'sub-1' });
        refund.mockResolvedValue({ id: 'rfnd_1', paymentId: 'rzp_pay_1', amount: MONTHLY.amount, status: 'processed' });

        const result = await runBillingReconcile(
            'pay-1',
            deps(buildPrisma({ profileUpdateThrows: true })),
        );

        expect(result).toEqual({ outcome: 'REFUNDED' });
        // Refund issued for the captured Razorpay payment id and full amount.
        expect(refund).toHaveBeenCalledTimes(1);
        expect(refund).toHaveBeenCalledWith({ paymentId: 'rzp_pay_1', amount: MONTHLY.amount });
        // Payment marked REFUNDED; profile NOT updated to PAID (tier unchanged).
        expect(updatePayment).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { status: 'REFUNDED' },
        });
        // The tx-scoped payment stamp never ran (transaction failed before it).
        expect(txUpdatePayment).not.toHaveBeenCalled();
    });
});

describe('runBillingReconcile — idempotency keyed by payment id', () => {
    it('treats an already-upgraded payment as a NOOP upgrade (no double allocation)', async () => {
        findUniquePayment.mockResolvedValue(capturedPayment({ subscriptionId: 'sub-1' }));

        const result = await runBillingReconcile('pay-1', deps(buildPrisma()));

        expect(result).toEqual({ outcome: 'ALREADY_UPGRADED', tier: 'PAID', aiQuota: MONTHLY.aiQuota });
        expect(upsertSubscription).not.toHaveBeenCalled();
        expect(updateProfile).not.toHaveBeenCalled();
        expect(refund).not.toHaveBeenCalled();
    });

    it('never refunds an already-refunded payment twice', async () => {
        findUniquePayment.mockResolvedValue(capturedPayment({ status: 'REFUNDED' }));

        const result = await runBillingReconcile('pay-1', deps(buildPrisma()));

        expect(result).toEqual({ outcome: 'ALREADY_REFUNDED' });
        expect(refund).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
    });

    it('is a NOOP for a payment that is not yet captured', async () => {
        findUniquePayment.mockResolvedValue(capturedPayment({ status: 'CREATED' }));

        const result = await runBillingReconcile('pay-1', deps(buildPrisma()));

        expect(result.outcome).toBe('NOOP');
        expect(upsertSubscription).not.toHaveBeenCalled();
        expect(refund).not.toHaveBeenCalled();
    });

    it('refunds when the captured amount matches no known plan', async () => {
        findUniquePayment.mockResolvedValue(capturedPayment({ amount: 1 }));
        refund.mockResolvedValue({ id: 'rfnd_1', paymentId: 'rzp_pay_1', amount: 1, status: 'processed' });

        const result = await runBillingReconcile('pay-1', deps(buildPrisma()));

        expect(result).toEqual({ outcome: 'REFUNDED' });
        expect(refund).toHaveBeenCalledWith({ paymentId: 'rzp_pay_1', amount: 1 });
        expect(upsertSubscription).not.toHaveBeenCalled();
    });

    it('is a NOOP when the payment does not exist', async () => {
        findUniquePayment.mockResolvedValue(null);

        const result = await runBillingReconcile('missing', deps(buildPrisma()));

        expect(result.outcome).toBe('NOOP');
    });
});
