/**
 * /api/subscriptions (task 16.2, design "Monetization / Subscription Service").
 *
 * GET returns the authenticated user's subscription tier, remaining AI quota, and payment
 * history. Guarded by {@link withAuth}; an unauthenticated request is rejected with 401
 * before the handler runs, and the handler scopes all reads to the authenticated user.
 */
import { withAuth } from '@/lib/auth';
import { getSubscriptionHandler } from '@/services/subscription';

export const GET = withAuth((request, auth) => getSubscriptionHandler(request, auth));
