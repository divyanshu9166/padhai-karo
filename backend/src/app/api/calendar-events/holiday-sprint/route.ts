/**
 * GET /api/calendar-events/holiday-sprint (task 6.7; design "Holiday and School Exam Mode";
 * Req 16.6).
 *
 * Surfaces the intensified "holiday study sprint" plan for the authenticated user's soonest
 * upcoming HOLIDAY Calendar_Event. When no holiday is upcoming, returns an
 * `{ available: false, plan: null }` offer. The intensified daily-load suggestion reuses the
 * timetable budget library's HOLIDAY_FACTOR so the offer stays aligned with how the generator
 * reshapes holiday load (Req 16.4).
 *
 * Guarded per the design "Authentication Posture" by {@link withAuth} (task 2.3):
 * unauthenticated requests are rejected with `401 UNAUTHORIZED` before the handler runs; the
 * handler then scopes its work to the authenticated user.
 */
import { withAuth } from '@/lib/auth';
import { holidaySprintHandler } from '@/services/calendar';

export const GET = withAuth((request, auth) => holidaySprintHandler(request, auth));
