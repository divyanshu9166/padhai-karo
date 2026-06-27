/**
 * GET /api/analytics/topic-priority (task 26.4, design "Topic Priority Service").
 *
 * Returns the authenticated user's topic prioritization analytics (Req 8.1, 14.1). Guarded
 * per the design "Authentication Posture": {@link withAuth} rejects unauthenticated requests
 * with 401 UNAUTHORIZED before the handler runs, and the handler scopes every query to the
 * authenticated user for per-user isolation.
 *
 * The handler logic lives in the topic priority service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { topicPriorityHandler } from '@/services/analytics/topicPriorityService';

export const GET = withAuth((request, auth) => topicPriorityHandler(request, auth));
