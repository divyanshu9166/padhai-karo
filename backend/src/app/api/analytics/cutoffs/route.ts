/**
 * GET /api/analytics/cutoffs (task 26.3, design "College Cutoff Reference Service").
 *
 * Lists the college cutoff reference rows applicable to the authenticated user's exam track
 * (Req 4.1, 14.1). Guarded by {@link withAuth}, which rejects unauthenticated requests with
 * 401 UNAUTHORIZED before the handler runs; the handler scopes reads to the authenticated user.
 *
 * The handler logic lives in the cutoff service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { listCutoffs } from '@/services/analytics/cutoffService';

export const GET = withAuth((request, auth) => listCutoffs(request, auth));
