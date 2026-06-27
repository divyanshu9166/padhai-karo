/**
 * /api/subscriptions/verify (task 16.2, design "Subscription Upgrade with Compensating
 * Refund"; Req 9.5, 9.6).
 *
 * POST verifies the Razorpay payment signature and, on success, applies the tier upgrade
 * (Paid + quota) via the shared reconciliation path; an invalid signature or a failed
 * upgrade (refunded, tier unchanged) returns 402. Guarded by {@link withAuth}; the handler
 * scopes the payment lookup to the authenticated user. The Razorpay client is injected by
 * the service (a mock is used in tests).
 */
import { withAuth } from '@/lib/auth';
import { verifyPaymentHandler } from '@/services/subscription';

export const POST = withAuth((request, auth) => verifyPaymentHandler(request, auth));
