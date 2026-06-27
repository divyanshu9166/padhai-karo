import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration tests for the subscription / billing flows (task 16.9; Req 9.5, 9.6).
 *
 * These thread the full order → verify → upgrade path through the real
 * {@link createOrderHandler} / {@link verifyPaymentHandler} and the shared
 * {@link runBillingReconcile}, against a mocked Prisma backed by a tiny in-memory store and
 * an injected mock {@link RazorpayGateway}. No live database, Redis, or Razorpay/HMAC call
 * runs.
 *
 * Covers:
 *   - order → verify (valid signature) → tier granted PAID + plan quota allocated (Req 9.5)
 *   - upgrade failure after capture → Razorpay refund issued, tier left UNCHANGED (Req 9.6)
 *
 * Validates: Requirements 9.5, 9.6
 */

interface PaymentRow {
    id: string;
    userId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string | null;
    amount: number;
    status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
    subscriptionId: string | null;
    createdAt: Date;
}

interface ProfileRow {
    userId: string;
    subscriptionTier: 'FREE' | 'PAID';
    aiQuota: number;
}

const db = vi.hoisted(() => ({
    payments: new Map<string, PaymentRow>(),
    profiles: new Map<string, ProfileRow>(),
    subscriptions: new Map<string, { id: string; userId: string; tier: 'PAID' }>(),
    seq: 0,
    failProfileUpdate: false,
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        payment: {
            create: vi.fn(async ({ data }: { data: Omit<PaymentRow, 'id' | 'createdAt' | 'razorpayPaymentId' | 'subscriptionId'> }) => {
                const id = `pay-${++db.seq}`;
                const row: PaymentRow = {
                    id,
                    razorpayPaymentId: null,
                    subscriptionId: null,
                    createdAt: new Date(),
                    ...data,
                };
                db.payments.set(id, row);
                return row;
            }),
            findFirst: vi.fn(async ({ where }: { where: { userId: string; razorpayOrderId: string; status: string } }) => {
                for (const p of db.payments.values()) {
                    if (p.userId === where.userId && p.razorpayOrderId === where.razorpayOrderId && p.status === where.status) {
                        return { ...p };
                    }
                }
                return null;
            }),
            findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
                const p = db.payments.get(where.id);
                return p ? { ...p } : null;
            }),
            update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<PaymentRow> }) => {
                const p = db.payments.get(where.id);
                if (!p) throw new Error('payment not found');
                Object.assign(p, data);
                return { ...p };
            }),
            findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
                [...db.payments.values()].filter((p) => p.userId === where.userId),
            ),
        },
        profile: {
            findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => {
                const p = db.profiles.get(where.userId);
                return p ? { ...p } : null;
            }),
            update: vi.fn(async ({ where, data }: { where: { userId: string }; data: Partial<ProfileRow> }) => {
                if (db.failProfileUpdate) throw new Error('profile update failed');
                const p = db.profiles.get(where.userId);
                if (!p) throw new Error('profile not found');
                Object.assign(p, data);
                return { ...p };
            }),
        },
        subscription: {
            upsert: vi.fn(async ({ where, create }: { where: { userId: string }; create: { userId: string; tier: 'PAID' } }) => {
                const existing = db.subscriptions.get(where.userId);
                if (existing) return existing;
                const sub = { id: `sub-${++db.seq}`, userId: create.userId, tier: 'PAID' as const };
                db.subscriptions.set(where.userId, sub);
                return sub;
            }),
        },
        $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    };
    return { default: prisma, prisma };
});

import { SUBSCRIPTION_PLANS } from './plans';
import { createOrderHandler, getSubscriptionHandler, verifyPaymentHandler } from './subscriptionService';
import type { RazorpayGateway } from './types';
import type { AuthContext } from '@/lib/auth';

const MONTHLY = SUBSCRIPTION_PLANS.monthly;
const BASE = 'http://localhost/api/subscriptions';

function post(url: string, body: unknown): Request {
    return new Request(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function authCtx(userId = 'user-7'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function mockGateway(overrides: Partial<RazorpayGateway> = {}): RazorpayGateway {
    return {
        createOrder: vi.fn(async () => ({ id: 'order_1', amount: MONTHLY.amount, currency: 'INR', status: 'created' })),
        verifyPaymentSignature: vi.fn(() => true),
        refund: vi.fn(async () => ({ id: 'rfnd_1', paymentId: 'rzp_pay_1', amount: MONTHLY.amount, status: 'processed' })),
        ...overrides,
    };
}

beforeEach(() => {
    db.payments.clear();
    db.profiles.clear();
    db.subscriptions.clear();
    db.seq = 0;
    db.failProfileUpdate = false;
    // Start every user on the FREE tier with no quota.
    db.profiles.set('user-7', { userId: 'user-7', subscriptionTier: 'FREE', aiQuota: 0 });
});

describe('billing — order → verify → tier grant (Req 9.5)', () => {
    it('grants PAID and allocates the plan quota after a verified payment', async () => {
        const gateway = mockGateway();

        // 1. Create the order — persists a CREATED payment.
        const orderRes = await createOrderHandler(post(`${BASE}/order`, { plan: 'monthly' }), authCtx(), gateway);
        expect(orderRes.status).toBe(201);
        const orderBody = (await orderRes.json()) as { razorpayOrderId: string; amount: number };
        expect(orderBody.razorpayOrderId).toBe('order_1');

        // The user is still FREE before verification.
        expect(db.profiles.get('user-7')?.subscriptionTier).toBe('FREE');

        // 2. Verify the payment — captures and runs the upgrade transaction.
        const verifyRes = await verifyPaymentHandler(
            post(`${BASE}/verify`, {
                razorpayOrderId: 'order_1',
                razorpayPaymentId: 'rzp_pay_1',
                signature: 'good_sig',
            }),
            authCtx(),
            gateway,
        );

        expect(verifyRes.status).toBe(200);
        const verifyBody = (await verifyRes.json()) as { tier: string; aiQuota: number };
        expect(verifyBody).toEqual({ tier: 'PAID', aiQuota: MONTHLY.aiQuota });

        // Profile upgraded + quota allocated; payment captured and stamped with subscription.
        const profile = db.profiles.get('user-7');
        expect(profile?.subscriptionTier).toBe('PAID');
        expect(profile?.aiQuota).toBe(MONTHLY.aiQuota);
        const payment = [...db.payments.values()][0];
        expect(payment.status).toBe('CAPTURED');
        expect(payment.subscriptionId).not.toBeNull();
        expect(gateway.refund).not.toHaveBeenCalled();

        // GET /subscriptions reflects the upgraded state.
        const getRes = await getSubscriptionHandler(new Request(BASE), authCtx());
        const getBody = (await getRes.json()) as { tier: string; aiQuota: number; payments: unknown[] };
        expect(getBody.tier).toBe('PAID');
        expect(getBody.aiQuota).toBe(MONTHLY.aiQuota);
        expect(getBody.payments).toHaveLength(1);
    });
});

describe('billing — upgrade failure → refund, tier unchanged (Req 9.6)', () => {
    it('issues a refund and leaves the tier unchanged when the upgrade transaction fails', async () => {
        const gateway = mockGateway();

        await createOrderHandler(post(`${BASE}/order`, { plan: 'monthly' }), authCtx(), gateway);

        // Force the upgrade transaction (profile update) to fail after capture.
        db.failProfileUpdate = true;

        const verifyRes = await verifyPaymentHandler(
            post(`${BASE}/verify`, {
                razorpayOrderId: 'order_1',
                razorpayPaymentId: 'rzp_pay_1',
                signature: 'good_sig',
            }),
            authCtx(),
            gateway,
        );

        expect(verifyRes.status).toBe(402);
        const body = (await verifyRes.json()) as { error: { code: string } };
        expect(body.error.code).toBe('PAYMENT_FAILED');

        // Compensation: refund issued for the captured payment id + amount.
        expect(gateway.refund).toHaveBeenCalledWith({ paymentId: 'rzp_pay_1', amount: MONTHLY.amount });

        // Tier UNCHANGED (still FREE, no quota); payment marked REFUNDED.
        const profile = db.profiles.get('user-7');
        expect(profile?.subscriptionTier).toBe('FREE');
        expect(profile?.aiQuota).toBe(0);
        const payment = [...db.payments.values()][0];
        expect(payment.status).toBe('REFUNDED');
        expect(payment.subscriptionId).toBeNull();
    });

    it('rejects a forged signature with 402 and never upgrades or refunds', async () => {
        const gateway = mockGateway({ verifyPaymentSignature: vi.fn(() => false) });

        await createOrderHandler(post(`${BASE}/order`, { plan: 'monthly' }), authCtx(), gateway);

        const verifyRes = await verifyPaymentHandler(
            post(`${BASE}/verify`, {
                razorpayOrderId: 'order_1',
                razorpayPaymentId: 'rzp_pay_1',
                signature: 'forged',
            }),
            authCtx(),
            gateway,
        );

        expect(verifyRes.status).toBe(402);
        expect(db.profiles.get('user-7')?.subscriptionTier).toBe('FREE');
        const payment = [...db.payments.values()][0];
        expect(payment.status).toBe('FAILED');
        expect(gateway.refund).not.toHaveBeenCalled();
    });
});
