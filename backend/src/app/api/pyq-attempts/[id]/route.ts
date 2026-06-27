/**
 * GET /api/pyq-attempts/:id (task 11.3, design "PYQ Practice + Scoring Service").
 *
 * Returns a single persisted PYQ attempt. Guarded per the design "Authentication Posture"
 * by {@link withAuth} (task 2.3): unauthenticated requests are rejected with
 * 401 UNAUTHORIZED before the handler runs. The handler enforces per-user ownership — an
 * attempt belonging to another user (or a missing attempt) returns 404 NOT_FOUND so the
 * existence of other users' attempts is not revealed.
 *
 * The framework forwards the dynamic `:id` segment as the route context's `params.id`,
 * which `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { PyqAttemptRouteContext } from '@/services/pyq/pyqAttemptService';
import { getPyqAttemptHandler } from '@/services/pyq/pyqAttemptService';

export const GET = withAuth<PyqAttemptRouteContext>((request, ctx, routeContext) =>
    getPyqAttemptHandler(request, ctx, routeContext),
);
