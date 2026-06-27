/**
 * GET /api/timed-attempts/:id (task 13.1, design "Timed Paper Mode Service").
 *
 * Returns a single persisted Timed Paper attempt. Guarded per the design "Authentication
 * Posture" by {@link withAuth} (task 2.3): unauthenticated requests are rejected with
 * 401 UNAUTHORIZED before the handler runs. The handler enforces per-user ownership — an
 * attempt belonging to another user (or a missing attempt) returns 404 NOT_FOUND so the
 * existence of other users' attempts is not revealed.
 *
 * The framework forwards the dynamic `:id` segment as the route context's `params.id`,
 * which `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { IdRouteContext } from '@/services/timedPaper';
import { getTimedAttemptHandler } from '@/services/timedPaper';

export const GET = withAuth<IdRouteContext>((request, ctx, routeContext) =>
    getTimedAttemptHandler(request, ctx, routeContext),
);
