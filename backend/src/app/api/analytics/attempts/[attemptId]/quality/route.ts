/**
 * GET /api/analytics/attempts/:attemptId/quality?type=PYQ|TIMED (task 26.5; design "Attempt
 * Quality endpoint", Req 9; Req 9.1, 14.1).
 *
 * Returns one attempt's quality metrics for the authenticated user. Guarded per the design
 * "Authentication Posture": {@link withAuth} (task 2.3) rejects unauthenticated requests with
 * 401 UNAUTHORIZED before the handler runs (Req 14.1). The framework forwards the dynamic
 * `:attemptId` segment as the route context's `params.attemptId`, which `withAuth` passes
 * through to the handler as its third argument.
 *
 * The handler logic lives in the analytics attempt-quality service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import type { AttemptQualityRouteContext } from '@/services/analytics/attemptQualityService';
import { getAttemptQualityHandler } from '@/services/analytics/attemptQualityService';

export const GET = withAuth<AttemptQualityRouteContext>((req, auth, ctx) =>
    getAttemptQualityHandler(req, auth, ctx),
);
