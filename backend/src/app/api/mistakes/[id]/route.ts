/**
 * DELETE /api/mistakes/:id (task 14.1, design "Mistake Journal Service", Req 18).
 *
 * Removes a single Mistake Journal entry. Guarded per the design "Authentication Posture"
 * by {@link withAuth} (task 2.3): unauthenticated requests are rejected with
 * `401 UNAUTHORIZED` before the handler runs. The handler enforces per-user ownership — a
 * missing entry returns `404 NOT_FOUND`, an entry owned by another user yields `403 FORBIDDEN`
 * — and returns `204 No Content` on success.
 *
 * The framework forwards the dynamic `:id` segment as the route context's `params.id`, which
 * `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { MistakeRouteContext } from '@/services/mistake';
import { deleteMistakeHandler } from '@/services/mistake';

export const DELETE = withAuth<MistakeRouteContext>((request, auth, routeContext) =>
    deleteMistakeHandler(request, auth, routeContext),
);
