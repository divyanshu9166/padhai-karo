/**
 * GET /api/analytics/rank-prediction (task 26.2, design "Rank Prediction Service").
 *
 * Returns the authenticated user's predicted rank derived from mock-test scores and reference
 * cutoff data (Req 3.1). Guarded per the design "Authentication Posture": {@link withAuth}
 * (task 2.3) rejects unauthenticated requests with 401 UNAUTHORIZED before the handler runs
 * (Req 14.1), and the handler scopes every read to the authenticated user for per-user
 * isolation.
 *
 * The handler logic lives in the analytics service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { getRankPredictionHandler } from '@/services/analytics/rankPredictionService';

export const GET = withAuth((request, auth) => getRankPredictionHandler(request, auth));
