/**
 * Concrete Razorpay gateway (task 16.2; design "Monetization / Subscription Service").
 *
 * A thin HTTP adapter over the Razorpay REST API implementing {@link RazorpayGateway}.
 * It reads the server-only key id/secret from {@link getConfig} (never shipped to the
 * client) and performs HTTP Basic auth. This adapter is intentionally NOT exercised by the
 * test suite — tests inject a mock gateway so no live network call or real-secret HMAC
 * runs. Signature verification delegates to the pure {@link verifyPaymentSignature} helper.
 */
import { getConfig } from '@/lib/config';

import { verifyPaymentSignature } from './signature';
import type {
    CreateOrderInput,
    RazorpayGateway,
    RazorpayOrder,
    RazorpayRefund,
    RefundInput,
    VerifyPaymentSignatureInput,
} from './types';

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

/** Build the HTTP Basic auth header from the configured key id/secret. */
function authHeader(keyId: string, keySecret: string): string {
    const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    return `Basic ${token}`;
}

/** The live Razorpay implementation used in production wiring. */
export class RazorpayHttpGateway implements RazorpayGateway {
    async createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
        const { keyId, keySecret } = getConfig().razorpay;
        const response = await fetch(`${RAZORPAY_API_BASE}/orders`, {
            method: 'POST',
            headers: {
                authorization: authHeader(keyId, keySecret),
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                amount: input.amount,
                currency: input.currency,
                receipt: input.receipt,
                notes: input.notes,
            }),
        });
        if (!response.ok) {
            throw new Error(`Razorpay createOrder failed with status ${response.status}`);
        }
        return (await response.json()) as RazorpayOrder;
    }

    verifyPaymentSignature(input: VerifyPaymentSignatureInput): boolean {
        const { keySecret } = getConfig().razorpay;
        return verifyPaymentSignature(input, keySecret);
    }

    async refund(input: RefundInput): Promise<RazorpayRefund> {
        const { keyId, keySecret } = getConfig().razorpay;
        const response = await fetch(
            `${RAZORPAY_API_BASE}/payments/${input.paymentId}/refund`,
            {
                method: 'POST',
                headers: {
                    authorization: authHeader(keyId, keySecret),
                    'content-type': 'application/json',
                },
                body: JSON.stringify(input.amount === undefined ? {} : { amount: input.amount }),
            },
        );
        if (!response.ok) {
            throw new Error(`Razorpay refund failed with status ${response.status}`);
        }
        return (await response.json()) as RazorpayRefund;
    }
}
