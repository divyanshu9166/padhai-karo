/**
 * /api/calendar-events (task 6.7; design "Timetable Generation Service" /
 * "Holiday and School Exam Mode"; Req 16.1, 16.2).
 *
 * POST persists a Calendar_Event (SCHOOL_EXAM / HOLIDAY / MOCK_TEST) with its date range for
 * the authenticated user, rejecting an unknown type or an end date earlier than the start
 * date with `422 VALIDATION_ERROR` (Req 16.1/16.2). GET lists the authenticated user's events,
 * optionally restricted to a `from`/`to` window.
 *
 * Both handlers are wrapped by the session-validation guard ({@link withAuth}, task 2.3),
 * which enforces the design "Authentication Posture": the request must carry a valid
 * `Authorization: Bearer <token>` session, otherwise it is rejected with `401 UNAUTHORIZED`
 * before the handler runs. Each handler then scopes its work to the authenticated user.
 */
import { withAuth } from '@/lib/auth';
import { createCalendarEventHandler, listCalendarEventsHandler } from '@/services/calendar';

export const POST = withAuth((request, auth) => createCalendarEventHandler(request, auth));

export const GET = withAuth((request, auth) => listCalendarEventsHandler(request, auth));
