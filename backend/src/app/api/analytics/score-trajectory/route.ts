/**
 * GET /api/analytics/score-trajectory (task 26.2, design "Score Trajectory Service").
 *
 * Returns the authenticated user's mock-test score trajectory (Req 2.1). Guarded per the
 * design "Authentication Posture": {@link withAuth} (task 2.3) rejects unauthenticated
 * requests with 401 UNAUTHORIZED before the handler runs (Req 14.1), and the handler scopes
 * every read to the authenticated user for per-user isolation.
 *
 * The handler logic lives in the analytics service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { getScoreTrajectoryHandler } from '@/services/analytics/scoreTrajectoryService';

export const GET = withAuth((request, auth) => getScoreTrajectoryHandler(request, auth));
