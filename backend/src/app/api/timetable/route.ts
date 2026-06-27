/**
 * /api/timetable (design "Timetable Generation Service"; Req 3.1).
 *
 * GET returns the authenticated user's persisted study blocks (study + buffer) for the week
 * identified by the `weekStart` query parameter. The handler is wrapped by {@link withAuth}
 * (task 2.3), so a request without a valid `Authorization: Bearer <token>` session is
 * rejected with `401 UNAUTHORIZED` before the handler runs; the read is scoped to the
 * authenticated user.
 */
import { withAuth } from '@/lib/auth';
import { getTimetableHandler } from '@/services/timetable';

export const GET = withAuth((request, auth) => getTimetableHandler(request, auth));
