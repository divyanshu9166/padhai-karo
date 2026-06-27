/**
 * GET /api/dashboard (task 9.1, design "Progress Dashboard Service").
 *
 * Returns the authenticated user's per-subject focused study time for the current day and
 * week, their streak, and their syllabus completion percent (Req 5.1–5.5, 12.4). Guarded
 * per the design "Authentication Posture": {@link withAuth} (task 2.3) rejects
 * unauthenticated requests with 401 UNAUTHORIZED before the handler runs, and the handler
 * scopes every query to the authenticated user for per-user isolation.
 *
 * The handler logic lives in the dashboard service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { getDashboardHandler } from '@/services/dashboard';

export const GET = withAuth((request, auth) => getDashboardHandler(request, auth));
