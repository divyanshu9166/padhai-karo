/**
 * GET /api/analytics/topic-trends (task 26.4, design "Topic Trend Service").
 *
 * Returns the authenticated user's topic-level trend analytics (Req 7.1, 14.1). Guarded per
 * the design "Authentication Posture": {@link withAuth} rejects unauthenticated requests with
 * 401 UNAUTHORIZED before the handler runs, and the handler scopes every query to the
 * authenticated user for per-user isolation.
 *
 * The handler logic lives in the topic trend service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { topicTrendsHandler } from '@/services/analytics/topicTrendService';

export const GET = withAuth((request, auth) => topicTrendsHandler(request, auth));
