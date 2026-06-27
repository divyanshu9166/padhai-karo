import { createHmac } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    computeHmacSha256,
    safeSignatureEqual,
    verifyHmacSignature,
    verifyPaymentSignature,
} from './signature';

/**
 * Unit + property tests for the pure Razorpay HMAC helpers (task 16.2). No network and no
 * config reads: verification is a pure function of (payload, signature, secret), shared by
 * `/subscriptions/verify` and the webhook endpoint (task 16.3).
 */
const SECRET = 'test_key_secret';

/** Reference signature for an order/payment pair, as Razorpay computes it. */
function signOrderPayment(orderId: string, paymentId: string, secret: string): string {
    return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

describe('verifyPaymentSignature', () => {
    it('accepts a correctly computed signature', () => {
        const orderId = 'order_ABC';
        const paymentId = 'pay_XYZ';
        const signature = signOrderPayment(orderId, paymentId, SECRET);
        expect(verifyPaymentSignature({ orderId, paymentId, signature }, SECRET)).toBe(true);
    });

    it('rejects a forged/incorrect signature', () => {
        expect(
            verifyPaymentSignature(
                { orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: 'deadbeef' },
                SECRET,
            ),
        ).toBe(false);
    });

    it('rejects a signature computed under a different secret', () => {
        const signature = signOrderPayment('order_ABC', 'pay_XYZ', 'other_secret');
        expect(
            verifyPaymentSignature({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature }, SECRET),
        ).toBe(false);
    });

    it('rejects an empty signature', () => {
        expect(
            verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: '' }, SECRET),
        ).toBe(false);
    });

    it('is not fooled by a "|" boundary shift between order and payment id', () => {
        // ("ab","c") and ("a","bc") must not collide on the same signed payload.
        const sigAbC = signOrderPayment('ab', 'c', SECRET);
        expect(verifyPaymentSignature({ orderId: 'a', paymentId: 'bc', signature: sigAbC }, SECRET)).toBe(
            false,
        );
    });
});

describe('verifyHmacSignature / computeHmacSha256', () => {
    it('verifies a generic payload signature (webhook-style)', () => {
        const payload = '{"event":"payment.captured"}';
        const sig = computeHmacSha256(payload, SECRET);
        expect(verifyHmacSignature(payload, sig, SECRET)).toBe(true);
        expect(verifyHmacSignature(payload, sig, 'wrong')).toBe(false);
    });

    it('property: a freshly computed HMAC always verifies; any other string does not', () => {
        fc.assert(
            fc.property(fc.string(), fc.string({ minLength: 1 }), (payload, secret) => {
                const sig = computeHmacSha256(payload, secret);
                expect(verifyHmacSignature(payload, sig, secret)).toBe(true);
                // A different secret must not verify the same payload/signature.
                expect(verifyHmacSignature(payload, sig, `${secret}x`)).toBe(false);
            }),
        );
    });
});

describe('safeSignatureEqual', () => {
    it('is true only for identical strings', () => {
        expect(safeSignatureEqual('abc', 'abc')).toBe(true);
        expect(safeSignatureEqual('abc', 'abd')).toBe(false);
        expect(safeSignatureEqual('abc', 'abcd')).toBe(false);
        expect(safeSignatureEqual('', '')).toBe(true);
    });
});
