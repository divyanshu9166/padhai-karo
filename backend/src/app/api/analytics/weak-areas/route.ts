/**
 * GET /api/analytics/weak-areas (task 26.6, design "Weak-Area endpoint").
 *
 * Returns the authenticated user's weak areas and session-type distribution (Req 11.1).
 * Guarded per the design "Authentication Posture": {@link withAuth} (task 2.3) rejects
 * unauthenticated requests with 401 UNAUTHORIZED before the handler runs (Req 14.1), and
 * the handler scopes every query to the authenticated user for per-user isolation.
 *
 * The handler logic lives in the weak-area service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { weakAreasHandler } from '@/services/analytics/weakAreaService';

export const GET = withAuth((request, auth) => weakAreasHandler(request, auth));
