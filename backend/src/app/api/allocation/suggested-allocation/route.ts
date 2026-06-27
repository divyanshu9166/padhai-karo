/**
 * GET /api/allocation/suggested-allocation (task 11.1; design "API endpoints").
 *
 * Returns the authenticated user's Suggested_Time_Allocation across pending Chapters and
 * upserts the per-user SuggestedAllocationSnapshot (Req 5, 6, 8, 7.1, 10.1). Guarded per the
 * design "Authentication posture": {@link withAuth} rejects unauthenticated requests with
 * 401 UNAUTHORIZED before the handler runs, and the handler scopes every query to the
 * authenticated user for per-user isolation.
 *
 * The handler logic lives in the suggested-allocation service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { suggestedAllocationHandler } from '@/services/allocation/suggestedAllocationService';

export const GET = withAuth((request, auth) => suggestedAllocationHandler(request, auth));
