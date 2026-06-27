/**
 * /api/webhooks/razorpay (task 16.3; design "Razorpay Webhook Verification"; Req 9.5).
 *
 * The ONLY endpoint that mutates state without a user session — it is deliberately NOT
 * wrapped with {@link withAuth}. Instead it is authenticated by the Razorpay webhook
 * signature: {@link razorpayWebhookHandler} reads the RAW request body via `request.text()`
 * and verifies the `X-Razorpay-Signature` HMAC over those exact bytes before acting.
 * Unverified payloads are rejected with `400`; recognized capture events are reconciled
 * idempotently; unrecognized events are acknowledged with `200`.
 *
 * `force-dynamic` keeps the route from being statically optimized so every webhook
 * delivery executes the handler.
 */
import { razorpayWebhookHandler } from '@/services/subscription';

export const dynamic = 'force-dynamic';

export const POST = (request: Request): Promise<Response> => razorpayWebhookHandler(request);
