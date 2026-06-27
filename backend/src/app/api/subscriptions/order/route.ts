/**
 * /api/subscriptions/order (task 16.2, design "Monetization / Subscription Service").
 *
 * POST creates a Razorpay order for the requested plan and persists a pending `Payment`
 * row, returning `{ razorpayOrderId, amount }`. Guarded by {@link withAuth}; the handler
 * scopes the created payment to the authenticated user. The Razorpay client is injected by
 * the service (a mock is used in tests).
 */
import { withAuth } from '@/lib/auth';
import { createOrderHandler } from '@/services/subscription';

export const POST = withAuth((request, auth) => createOrderHandler(request, auth));
