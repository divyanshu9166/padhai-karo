/**
 * The Razorpay gateway seam (task 16.2; design "Monetization / Subscription Service").
 *
 * Razorpay is abstracted behind {@link RazorpayGateway} so the service and the
 * `billing-reconcile` worker depend only on this interface. Tests inject a mock
 * implementation, so the suite never performs a live network call or HMAC against real
 * secrets. The concrete HTTP/SDK implementation lives in `razorpayGateway.ts` as a thin
 * adapter that is NOT exercised by tests.
 */

/** Inputs for creating a Razorpay order. `amount` is in the smallest currency unit. */
export interface CreateOrderInput {
    amount: number;
    currency: string;
    /** Optional idempotency/reconciliation receipt (e.g. the local Payment id). */
    receipt?: string;
    /** Optional opaque key/value notes stored on the Razorpay order. */
    notes?: Record<string, string>;
}

/** The subset of a Razorpay order the service relies on. */
export interface RazorpayOrder {
    id: string;
    amount: number;
    currency: string;
    status: string;
}

/** Inputs for verifying a checkout payment signature. */
export interface VerifyPaymentSignatureInput {
    orderId: string;
    paymentId: string;
    signature: string;
}

/** Inputs for issuing a refund against a captured payment. */
export interface RefundInput {
    /** The Razorpay payment id to refund. */
    paymentId: string;
    /** Optional partial refund amount in the smallest currency unit; full refund if omitted. */
    amount?: number;
}

/** The subset of a Razorpay refund the worker relies on. */
export interface RazorpayRefund {
    id: string;
    paymentId: string;
    amount: number;
    status: string;
}

/**
 * The Razorpay gateway abstraction. Implementations:
 *   - `createOrder` — create a payment order (network).
 *   - `verifyPaymentSignature` — pure HMAC check of a checkout signature (no network).
 *   - `refund` — issue a refund for the compensation path (network, Req 9.6).
 *
 * `createOrder`/`refund` reject on transport/provider failure. `verifyPaymentSignature` is
 * synchronous and total: it returns `false` for an invalid/forged signature rather than
 * throwing.
 */
export interface RazorpayGateway {
    createOrder(input: CreateOrderInput): Promise<RazorpayOrder>;
    verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean;
    refund(input: RefundInput): Promise<RazorpayRefund>;
}
