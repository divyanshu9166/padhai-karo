/**
 * GET /api/analytics/score-gap (task 26.3, design "Score Gap Analysis Service").
 *
 * Returns the gap between the authenticated user's projected score and their target college
 * cutoff, surfacing the target-required and reference-unavailable states (Req 4.2, 14.1).
 * Guarded by {@link withAuth}, which rejects unauthenticated requests with 401 UNAUTHORIZED
 * before the handler runs; the handler scopes reads to the authenticated user.
 *
 * The handler logic lives in the score gap service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { getScoreGapHandler } from '@/services/analytics/scoreGapService';

export const GET = withAuth((request, auth) => getScoreGapHandler(request, auth));
