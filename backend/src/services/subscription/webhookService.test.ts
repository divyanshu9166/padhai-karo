import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SUBSCRIPTION_PLANS } from './plans';
import { computeHmacSha256 } from './signature';
import {
    handleRazorpayWebhook,
    type WebhookDeps,
    type WebhookPaymentRow,
    type WebhookPrisma,
} from './webhookService';
import type { RazorpayGateway } from './types';

/**
 * DB/Redis/network-independent tests for the Razorpay webhook handler (task 16.3; Req 9.5,
 * design "Razorpay Webhook Verification"). A mocked Prisma and a mocked RazorpayGateway are
 * injected and the HMAC is verified against an explicit test secret, so the suite never
 * touches a live database, Redis, or the Razorpay network.
 *
 * Covers:
 *   - invalid signature → 400, NO state mutation
 *   - missing signature header → 400, NO state mutation
 *   - valid signature + recognized capture event → payment captured + reconcile invoked
 *   - already-captured payment → reconcile invoked idempotently (no re-capture write)
 *   - unrecognized event type → 200 no-op
 *   - the signature is computed over the EXACT raw body bytes
 */
const MONTHLY = SUBSCRIPTION_PLANS.monthly;
const SECRET = 'whsec_test_secret';

// --- Mocks -------------------------------------------------------------------
const findFirstPayment = vi.fn();
const updatePayment = vi.fn();
const findUniquePayment = vi.fn();
const reconcileUpdatePayment = vi.fn();
const upsertSubscription = vi.fn();
const updateProfile = vi.fn();
const txUpdatePayment = vi.fn();
const refund = vi.fn();
const createOrder = vi.fn();
const verifyPaymentSignature = vi.fn();

/**
 * A combined Prisma mock that satisfies both the webhook's own slice (findFirst/update) and
 * the {@link ReconcilePrisma} shape that {@link runBillingReconcile} reads through. The
 * `$transaction` runs its callback against tx-scoped spies (mirrors reconcile.test.ts).
 */
function buildPrisma(): WebhookPrisma {
    const tx = {
        subscription: { upsert: upsertSubscription },
        profile: { update: updateProfile },
        payment: { update: txUpdatePayment },
    };
    const prisma = {
        payment: {
            findFirst: findFirstPayment,
            update: updatePayment,
            findUnique: findUniquePayment,
        },
        $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    // Reconcile's payment.update spy is the same object's update; route it through.
    reconcileUpdatePayment.mockImplementation(updatePayment);
    return prisma as unknown as WebhookPrisma;
}

function gateway(): RazorpayGateway {
    return { createOrder, verifyPaymentSignature, refund };
}

function deps(): WebhookDeps {
    return { prisma: buildPrisma(), gateway: gateway(), webhookSecret: SECRET };
}

/** Build a Razorpay-shaped event body for a capture, as a raw JSON string. */
function captureEventBody(
    event = 'payment.captured',
    orderId = 'order_1',
    paymentId = 'rzp_pay_1',
): string {
    return JSON.stringify({
        event,
        payload: {
            payment: { entity: { id: paymentId, order_id: orderId, status: 'captured' } },
            order: { entity: { id: orderId } },
        },
    });
}

/** Sign a raw body with the test secret exactly as Razorpay would. */
function sign(rawBody: string): string {
    return computeHmacSha256(rawBody, SECRET);
}

function createdPayment(overrides: Partial<WebhookPaymentRow> = {}): WebhookPaymentRow {
    return { id: 'pay-1', status: 'CREATED', razorpayPaymentId: null, ...overrides };
}

beforeEach(() => {
    findFirstPayment.mockReset();
    updatePayment.mockReset();
    findUniquePayment.mockReset();
    reconcileUpdatePayment.mockReset();
    upsertSubscription.mockReset();
    updateProfile.mockReset();
    txUpdatePayment.mockReset();
    refund.mockReset();
    createOrder.mockReset();
    verifyPaymentSignature.mockReset();
});

describe('handleRazorpayWebhook — signature authentication (Req 9.5)', () => {
    it('rejects an invalid signature with 400 and mutates no state', async () => {
        const body = captureEventBody();

        const res = await handleRazorpayWebhook(body, 'deadbeef', deps());

        expect(res.status).toBe(400);
        const json = (await res.json()) as { error: { code: string } };
        expect(json.error.code).toBe('VALIDATION_ERROR');
        // No lookup, no capture, no upgrade.
        expect(findFirstPayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
        expect(upsertSubscription).not.toHaveBeenCalled();
        expect(updateProfile).not.toHaveBeenCalled();
    });

    it('rejects a missing signature header with 400 and mutates no state', async () => {
        const body = captureEventBody();

        const res = await handleRazorpayWebhook(body, null, deps());

        expect(res.status).toBe(400);
        expect(findFirstPayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
    });

    it('rejects a body that does not match the provided signature (tamper) with 400', async () => {
        const signed = captureEventBody('payment.captured', 'order_1');
        const tampered = captureEventBody('payment.captured', 'order_ATTACKER');

        // Signature is valid for `signed` but the body sent is `tampered`.
        const res = await handleRazorpayWebhook(tampered, sign(signed), deps());

        expect(res.status).toBe(400);
        expect(findFirstPayment).not.toHaveBeenCalled();
    });
});

describe('handleRazorpayWebhook — recognized capture event (Req 9.5)', () => {
    it('captures the pending payment and runs reconciliation on a verified event', async () => {
        const body = captureEventBody();
        findFirstPayment.mockResolvedValue(createdPayment());
        updatePayment.mockResolvedValue({});
        // Reconcile re-reads the payment as CAPTURED, then upgrades.
        findUniquePayment.mockResolvedValue({
            id: 'pay-1',
            userId: 'user-1',
            razorpayOrderId: 'order_1',
            razorpayPaymentId: 'rzp_pay_1',
            amount: MONTHLY.amount,
            status: 'CAPTURED',
            subscriptionId: null,
        });
        upsertSubscription.mockResolvedValue({ id: 'sub-1' });
        updateProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: MONTHLY.aiQuota });

        const res = await handleRazorpayWebhook(body, sign(body), deps());

        expect(res.status).toBe(200);
        expect(findFirstPayment).toHaveBeenCalledWith({ where: { razorpayOrderId: 'order_1' } });
        // Marked CAPTURED with the Razorpay payment id before reconciliation.
        expect(updatePayment).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { status: 'CAPTURED', razorpayPaymentId: 'rzp_pay_1' },
        });
        // Reconciliation applied the upgrade.
        expect(updateProfile).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            data: { subscriptionTier: 'PAID', aiQuota: MONTHLY.aiQuota },
        });
        expect(refund).not.toHaveBeenCalled();
    });

    it('is idempotent: an already-upgraded payment is reconciled without re-capturing', async () => {
        const body = captureEventBody('order.paid');
        findFirstPayment.mockResolvedValue(
            createdPayment({ status: 'CAPTURED', razorpayPaymentId: 'rzp_pay_1' }),
        );
        // Reconcile sees the payment already stamped with a subscription → ALREADY_UPGRADED.
        findUniquePayment.mockResolvedValue({
            id: 'pay-1',
            userId: 'user-1',
            razorpayOrderId: 'order_1',
            razorpayPaymentId: 'rzp_pay_1',
            amount: MONTHLY.amount,
            status: 'CAPTURED',
            subscriptionId: 'sub-1',
        });

        const res = await handleRazorpayWebhook(body, sign(body), deps());

        expect(res.status).toBe(200);
        // Not re-captured (already CAPTURED) and not re-upgraded.
        expect(updatePayment).not.toHaveBeenCalled();
        expect(upsertSubscription).not.toHaveBeenCalled();
        expect(updateProfile).not.toHaveBeenCalled();
        expect(refund).not.toHaveBeenCalled();
    });

    it('acknowledges (200) without acting when no local payment matches the order', async () => {
        const body = captureEventBody();
        findFirstPayment.mockResolvedValue(null);

        const res = await handleRazorpayWebhook(body, sign(body), deps());

        expect(res.status).toBe(200);
        expect(updatePayment).not.toHaveBeenCalled();
        expect(findUniquePayment).not.toHaveBeenCalled();
    });
});

describe('handleRazorpayWebhook — defensive handling of untrusted payloads', () => {
    it('acknowledges (200) and does not act on an unrecognized event type', async () => {
        const body = JSON.stringify({ event: 'payment.failed', payload: {} });

        const res = await handleRazorpayWebhook(body, sign(body), deps());

        expect(res.status).toBe(200);
        const json = (await res.json()) as { received: boolean };
        expect(json.received).toBe(true);
        expect(findFirstPayment).not.toHaveBeenCalled();
        expect(updatePayment).not.toHaveBeenCalled();
    });

    it('rejects a malformed (non-JSON) body with 400 even when the signature matches', async () => {
        const body = 'not-json{';

        const res = await handleRazorpayWebhook(body, sign(body), deps());

        expect(res.status).toBe(400);
        expect(findFirstPayment).not.toHaveBeenCalled();
    });

    it('acknowledges a recognized event that is missing the order reference', async () => {
        const body = JSON.stringify({ event: 'payment.captured', payload: { payment: {} } });

        const res = await handleRazorpayWebhook(body, sign(body), deps());

        expect(res.status).toBe(200);
        expect(findFirstPayment).not.toHaveBeenCalled();
    });

    it('verifies the signature over the exact raw body bytes', async () => {
        // A semantically-equal but differently-serialized body must NOT verify against a
        // signature computed over the original bytes (proves raw-body, not object, signing).
        const raw = captureEventBody();
        const reserialized = JSON.stringify(JSON.parse(raw)); // same object, may differ in bytes
        const spaced = `${raw} `; // a single trailing space changes the bytes

        findFirstPayment.mockResolvedValue(createdPayment());
        updatePayment.mockResolvedValue({});
        findUniquePayment.mockResolvedValue({
            id: 'pay-1',
            userId: 'user-1',
            razorpayOrderId: 'order_1',
            razorpayPaymentId: 'rzp_pay_1',
            amount: MONTHLY.amount,
            status: 'CAPTURED',
            subscriptionId: null,
        });
        upsertSubscription.mockResolvedValue({ id: 'sub-1' });
        updateProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: MONTHLY.aiQuota });

        // The exact bytes verify.
        const ok = await handleRazorpayWebhook(raw, sign(raw), deps());
        expect(ok.status).toBe(200);

        // A signature over the original bytes does not verify a body with an extra space.
        const bad = await handleRazorpayWebhook(spaced, sign(raw), deps());
        expect(bad.status).toBe(400);

        // Sanity: the reserialized form, signed as itself, still verifies.
        const ok2 = await handleRazorpayWebhook(reserialized, sign(reserialized), deps());
        expect(ok2.status).toBe(200);
    });
});
