/**
 * Razorpay HMAC signature verification (task 16.2; design "Payment Failures &
 * Refund-on-Upgrade-Failure" and "Razorpay Webhook Verification").
 *
 * Pure, dependency-free helpers built on Node's `crypto`. Keeping verification pure (no
 * network, no config reads) makes it directly unit-testable and lets it be shared by both
 * `POST /subscriptions/verify` (payment signature, this task) and the
 * `POST /webhooks/razorpay` endpoint (raw-body signature, task 16.3).
 *
 * Comparisons use a constant-time check so a verification result never leaks timing
 * information about how much of the expected signature matched.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Compute the lowercase hex HMAC-SHA256 of `payload` under `secret`. */
export function computeHmacSha256(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Constant-time comparison of two hex signature strings. Returns `false` (rather than
 * throwing) when lengths differ, so a malformed/empty client signature is simply invalid.
 */
export function safeSignatureEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a generic Razorpay HMAC signature: recompute `HMAC-SHA256(payload, secret)` and
 * compare it in constant time to `providedSignature`. This is the shared primitive used
 * for both the payment-verification signature and the webhook signature.
 */
export function verifyHmacSignature(
    payload: string,
    providedSignature: string,
    secret: string,
): boolean {
    if (typeof providedSignature !== 'string' || providedSignature.length === 0) {
        return false;
    }
    return safeSignatureEqual(computeHmacSha256(payload, secret), providedSignature);
}

/** Inputs to a Razorpay payment-signature verification. */
export interface PaymentSignatureInput {
    /** The Razorpay order id returned when the order was created. */
    orderId: string;
    /** The Razorpay payment id reported by the client after checkout. */
    paymentId: string;
    /** The signature the client received from Razorpay checkout. */
    signature: string;
}

/**
 * Verify a Razorpay payment signature. Per Razorpay's contract the signed payload is
 * `"{orderId}|{paymentId}"` and the key is the account's key secret. Returns `true` only
 * when the recomputed HMAC matches the provided signature in constant time.
 */
export function verifyPaymentSignature(
    input: PaymentSignatureInput,
    keySecret: string,
): boolean {
    const payload = `${input.orderId}|${input.paymentId}`;
    return verifyHmacSignature(payload, input.signature, keySecret);
}
