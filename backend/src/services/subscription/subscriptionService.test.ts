import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DB/Redis/network-independent example tests for the subscription service (task 16.2;
 * Req 9.5, 9.6). Prisma is mocked and the Razorpay client is injected as a mock gateway, so
 * the suite never touches a live database or makes a real Razorpay/HMAC call.
 *
 * Covers:
 *   - POST /subscriptions/order  : creates an order + pending Payment, returns 201
 *   - POST /subscriptions/verify : valid signature → upgrade applied (tier PAID + quota)
 *   - POST /subscriptions/verify : invalid signature → 402 PAYMENT_FAILED, tier unchanged
 *   - GET  /subscriptions        : returns tier, quota, and payment history
 *
 * Validates: Requirements 9.5, 9.6
 */

// --- Prisma mock -------------------------------------------------------------
const {
    createPayment,
    findFirstPayment,
    findUniquePayment,
    updatePayment,
    findManyPayment,
    findUniqueProfile,
    updateProfile,
    upsertSubscription,
} = vi.hoisted(() => ({
    createPayment: vi.fn(),
    findFirstPayment: vi.fn(),
    findUniquePayment: vi.fn(),
    updatePayment: vi.fn(),
    findManyPayment: vi.fn(),
    findUniqueProfile: vi.fn(),
    updateProfile: vi.fn(),
    upsertSubscription: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        payment: {
            create: createPayment,
            findFirst: findFirstPayment,
            findUnique: findUniquePayment,
            update: updatePayment,
            findMany: findManyPayment,
        },
        profile: { findUnique: findUniqueProfile, update: updateProfile },
        subscription: { upsert: upsertSubscription },
        // Interactive transaction: run the callback against the same mock client.
        $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
    };
    return { default: prisma, prisma };
});

import { SUBSCRIPTION_PLANS } from './plans';
import {
    createOrderHandler,
    getSubscriptionHandler,
    verifyPaymentHandler,
} from './subscriptionService';
import type { RazorpayGateway } from './types';
import type { AuthContext } from '@/lib/auth';

const MONTHLY = SUBSCRIPTION_PLANS.monthly;
const BASE = 'http://localhost/api/subscriptions';

function post(url: string, body?: unknown): Request {
    return new Request(url, {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function mockGateway(overrides: Partial<RazorpayGateway> = {}): RazorpayGateway {
    return {
        createOrder: vi.fn(async () => ({
            id: 'order_1',
            amount: MONTHLY.amount,
            currency: 'INR',
            status: 'created',
        })),
        verifyPaymentSignature: vi.fn(() => true),
        refund: vi.fn(async () => ({
            id: 'rfnd_1',
            paymentId: 'rzp_pay_1',
            amount: MONTHLY.amount,
            status: 'processed',
        })),
        ...overrides,
    };
}

beforeEach(() => {
    createPayment.mockReset();
    findFirstPayment.mockReset();
    findUniquePayment.mockReset();
    updatePayment.mockReset();
    findManyPayment.mockReset();
    findUniqueProfile.mockReset();
    updateProfile.mockReset();
    upsertSubscription.mockReset();
});

describe('createOrderHandler', () => {
    it('creates a Razorpay order and a pending Payment, returns 201', async () => {
        createPayment.mockResolvedValue({ id: 'pay-1' });
        const gateway = mockGateway();

        const res = await createOrderHandler(
            post(`${BASE}/order`, { plan: 'monthly' }),
            authCtx('user-7'),
            gateway,
        );

        expect(res.status).toBe(201);
        const body = (await res.json()) as { razorpayOrderId: string; amount: number };
        expect(body).toEqual({ razorpayOrderId: 'order_1', amount: MONTHLY.amount });

        expect(gateway.createOrder).toHaveBeenCalledWith({
            amount: MONTHLY.amount,
            currency: 'INR',
            notes: { userId: 'user-7', plan: 'monthly' },
        });
        expect(createPayment).toHaveBeenCalledWith({
            data: {
                userId: 'user-7',
                razorpayOrderId: 'order_1',
                amount: MONTHLY.amount,
                status: 'CREATED',
            },
        });
    });

    it('rejects an unknown plan with 422 and creates no order', async () => {
        const gateway = mockGateway();

        const res = await createOrderHandler(post(`${BASE}/order`, { plan: 'weekly' }), authCtx(), gateway);

        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(gateway.createOrder).not.toHaveBeenCalled();
        expect(createPayment).not.toHaveBeenCalled();
    });
});

describe('verifyPaymentHandler — valid signature → upgrade applied (Req 9.5)', () => {
    it('marks the payment CAPTURED and returns the upgraded tier + allocated quota', async () => {
        findFirstPayment.mockResolvedValue({
            id: 'pay-1',
            userId: 'user-7',
            razorpayOrderId: 'order_1',
            amount: MONTHLY.amount,
            status: 'CREATED',
            subscriptionId: null,
            razorpayPaymentId: null,
        });
        // After capture, the reconciliation re-reads the payment in its CAPTURED state.
        findUniquePayment.mockResolvedValue({
            id: 'pay-1',
            userId: 'user-7',
            razorpayOrderId: 'order_1',
            razorpayPaymentId: 'rzp_pay_1',
            amount: MONTHLY.amount,
            status: 'CAPTURED',
            subscriptionId: null,
        });
        upsertSubscription.mockResolvedValue({ id: 'sub-1' });
        updateProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: MONTHLY.aiQuota });
        updatePayment.mockResolvedValue({});

        const gateway = mockGateway({ verifyPaymentSignature: vi.fn(() => true) });
        const res = await verifyPaymentHandler(
            post(`${BASE}/verify`, {
                razorpayOrderId: 'order_1',
                razorpayPaymentId: 'rzp_pay_1',
                signature: 'good_sig',
            }),
            authCtx('user-7'),
            gateway,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { tier: string; aiQuota: number };
        expect(body).toEqual({ tier: 'PAID', aiQuota: MONTHLY.aiQuota });

        // Payment captured (with the Razorpay payment id) before the upgrade.
        expect(updatePayment).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { status: 'CAPTURED', razorpayPaymentId: 'rzp_pay_1' },
        });
        // Profile upgraded to PAID with the plan's quota.
        expect(updateProfile).toHaveBeenCalledWith({
            where: { userId: 'user-7' },
            data: { subscriptionTier: 'PAID', aiQuota: MONTHLY.aiQuota },
        });
        expect(gateway.refund).not.toHaveBeenCalled();
    });
});

describe('verifyPaymentHandler — invalid signature → 402 (Req 9.6)', () => {
    it('rejects with 402 PAYMENT_FAILED, marks FAILED, and does not change the tier', async () => {
        findFirstPayment.mockResolvedValue({
            id: 'pay-1',
            userId: 'user-7',
            razorpayOrderId: 'order_1',
            amount: MONTHLY.amount,
            status: 'CREATED',
            subscriptionId: null,
            razorpayPaymentId: null,
        });
        updatePayment.mockResolvedValue({});

        const gateway = mockGateway({ verifyPaymentSignature: vi.fn(() => false) });
        const res = await verifyPaymentHandler(
            post(`${BASE}/verify`, {
                razorpayOrderId: 'order_1',
                razorpayPaymentId: 'rzp_pay_1',
                signature: 'forged',
            }),
            authCtx('user-7'),
            gateway,
        );

        expect(res.status).toBe(402);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('PAYMENT_FAILED');

        expect(updatePayment).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { status: 'FAILED' },
        });
        // No upgrade, no reconciliation read.
        expect(updateProfile).not.toHaveBeenCalled();
        expect(findUniquePayment).not.toHaveBeenCalled();
    });

    it('returns 404 when no pending order exists for the user', async () => {
        findFirstPayment.mockResolvedValue(null);

        const res = await verifyPaymentHandler(
            post(`${BASE}/verify`, {
                razorpayOrderId: 'order_unknown',
                razorpayPaymentId: 'rzp_pay_1',
                signature: 'sig',
            }),
            authCtx('user-7'),
            mockGateway(),
        );

        expect(res.status).toBe(404);
    });

    it('returns 422 when required fields are missing', async () => {
        const res = await verifyPaymentHandler(
            post(`${BASE}/verify`, { razorpayOrderId: 'order_1' }),
            authCtx(),
            mockGateway(),
        );

        expect(res.status).toBe(422);
        expect(findFirstPayment).not.toHaveBeenCalled();
    });
});

describe('verifyPaymentHandler — upgrade fails after capture → refund, 402 (Req 9.6)', () => {
    it('returns 402 and leaves the tier unchanged when the upgrade transaction fails', async () => {
        findFirstPayment.mockResolvedValue({
            id: 'pay-1',
            userId: 'user-7',
            razorpayOrderId: 'order_1',
            amount: MONTHLY.amount,
            status: 'CREATED',
            subscriptionId: null,
            razorpayPaymentId: null,
        });
        findUniquePayment.mockResolvedValue({
            id: 'pay-1',
            userId: 'user-7',
            razorpayOrderId: 'order_1',
            razorpayPaymentId: 'rzp_pay_1',
            amount: MONTHLY.amount,
            status: 'CAPTURED',
            subscriptionId: null,
        });
        upsertSubscription.mockResolvedValue({ id: 'sub-1' });
        // Upgrade transaction fails inside the profile update.
        updateProfile.mockRejectedValue(new Error('db down'));
        updatePayment.mockResolvedValue({});

        const gateway = mockGateway({ verifyPaymentSignature: vi.fn(() => true) });
        const res = await verifyPaymentHandler(
            post(`${BASE}/verify`, {
                razorpayOrderId: 'order_1',
                razorpayPaymentId: 'rzp_pay_1',
                signature: 'good_sig',
            }),
            authCtx('user-7'),
            gateway,
        );

        expect(res.status).toBe(402);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('PAYMENT_FAILED');
        // Compensation: refund issued and payment marked REFUNDED.
        expect(gateway.refund).toHaveBeenCalledWith({ paymentId: 'rzp_pay_1', amount: MONTHLY.amount });
        expect(updatePayment).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { status: 'REFUNDED' },
        });
    });
});

describe('getSubscriptionHandler', () => {
    it('returns the tier, remaining quota, and payment history', async () => {
        findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: 42 });
        findManyPayment.mockResolvedValue([{ id: 'pay-2' }, { id: 'pay-1' }]);

        const res = await getSubscriptionHandler(new Request(BASE), authCtx('user-7'));

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            tier: string;
            aiQuota: number;
            payments: Array<{ id: string }>;
        };
        expect(body.tier).toBe('PAID');
        expect(body.aiQuota).toBe(42);
        expect(body.payments).toHaveLength(2);
        expect(findManyPayment).toHaveBeenCalledWith({
            where: { userId: 'user-7' },
            orderBy: { createdAt: 'desc' },
        });
    });

    it('returns 404 when the user has no profile', async () => {
        findUniqueProfile.mockResolvedValue(null);

        const res = await getSubscriptionHandler(new Request(BASE), authCtx());

        expect(res.status).toBe(404);
    });
});
