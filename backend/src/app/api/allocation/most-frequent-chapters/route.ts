/**
 * GET /api/allocation/most-frequent-chapters (task 10.2, design "Allocation Service endpoints").
 *
 * Returns the authenticated user's Most_Frequent_Chapters list (Req 4.1, 4.2, 10.1). Guarded
 * per the design "Authentication Posture": {@link withAuth} rejects unauthenticated requests
 * with 401 UNAUTHORIZED before the handler runs, and the handler scopes every query to the
 * authenticated user for per-user isolation.
 *
 * The handler logic lives in the most-frequent service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { mostFrequentChaptersHandler } from '@/services/allocation/mostFrequentService';

export const GET = withAuth((request, auth) => mostFrequentChaptersHandler(request, auth));
