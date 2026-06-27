/**
 * GET /api/analytics/attempt-quality-trend?subjectId=&from=&to= (task 26.5; design "Attempt
 * Quality Trend endpoint", Req 10; Req 10.1, 14.1).
 *
 * Returns the authenticated user's attempt-quality trend. Guarded per the design
 * "Authentication Posture": {@link withAuth} (task 2.3) rejects unauthenticated requests with
 * 401 UNAUTHORIZED before the handler runs (Req 14.1), and the handler scopes every query to
 * the authenticated user for per-user isolation.
 *
 * The handler logic lives in the analytics attempt-quality-trend service so the route stays
 * thin.
 */
import { withAuth } from '@/lib/auth';
import { getAttemptQualityTrendHandler } from '@/services/analytics/attemptQualityTrendService';

export const GET = withAuth((req, auth) => getAttemptQualityTrendHandler(req, auth));
