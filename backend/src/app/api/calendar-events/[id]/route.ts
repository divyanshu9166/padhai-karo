/**
 * DELETE /api/calendar-events/:id (task 6.7; design "Holiday and School Exam Mode"; Req 16).
 *
 * Removes a single Calendar_Event. Guarded per the design "Authentication Posture" by
 * {@link withAuth} (task 2.3): unauthenticated requests are rejected with `401 UNAUTHORIZED`
 * before the handler runs. The handler enforces per-user ownership — a missing event returns
 * `404 NOT_FOUND`, an event owned by another user yields `403 FORBIDDEN` — and returns
 * `204 No Content` on success.
 *
 * The framework forwards the dynamic `:id` segment as the route context's `params.id`, which
 * `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { CalendarEventRouteContext } from '@/services/calendar';
import { deleteCalendarEventHandler } from '@/services/calendar';

export const DELETE = withAuth<CalendarEventRouteContext>((request, auth, routeContext) =>
    deleteCalendarEventHandler(request, auth, routeContext),
);
