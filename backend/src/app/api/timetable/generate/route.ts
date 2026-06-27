/**
 * /api/timetable/generate (design "Timetable Generation Service"; Req 3.1, 3.2, 3.3).
 *
 * POST runs the full weekly timetable generation pipeline for the authenticated user and
 * persists the result, replacing any existing timetable for the same `weekStart`. The
 * handler is wrapped by {@link withAuth} (task 2.3), so a request without a valid
 * `Authorization: Bearer <token>` session is rejected with `401 UNAUTHORIZED` before the
 * handler runs; the handler then scopes every read/write to the authenticated user.
 */
import { withAuth } from '@/lib/auth';
import { generateTimetableHandler } from '@/services/timetable';

export const POST = withAuth((request, auth) => generateTimetableHandler(request, auth));
