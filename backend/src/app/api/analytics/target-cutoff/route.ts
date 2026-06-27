/**
 * GET/PUT /api/analytics/target-cutoff (task 26.3, design "College Cutoff Reference Service").
 *
 * GET returns the authenticated user's selected target college cutoff; PUT upserts it
 * (Req 4.1, 4.2, 14.1). Guarded by {@link withAuth}, which rejects unauthenticated requests
 * with 401 UNAUTHORIZED before the handler runs; the handlers scope reads and writes to the
 * authenticated user for per-user isolation.
 *
 * The handler logic lives in the cutoff service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { getTargetCutoff, setTargetCutoff } from '@/services/analytics/cutoffService';

export const GET = withAuth((request, auth) => getTargetCutoff(request, auth));
export const PUT = withAuth((request, auth) => setTargetCutoff(request, auth));
