/**
 * Calendar-Event service (task 6.7; design "Timetable Generation Service" /
 * "Holiday and School Exam Mode"; Req 16.1, 16.2, 16.6).
 *
 * Implements the calendar-event CRUD endpoints plus the holiday-sprint offer:
 *
 *   POST /api/calendar-events
 *     body: { type, startDate, endDate }
 *     -> 201 { event }                                              (Req 16.1)
 *     -> 422 VALIDATION_ERROR  (unknown type, or endDate earlier than startDate — Req 16.2)
 *
 *   GET /api/calendar-events?from=&to=
 *     -> 200 { events[] }  the user's events, optionally restricted to those overlapping the
 *                          [from, to] window; always user-scoped.
 *
 *   DELETE /api/calendar-events/:id
 *     -> 204  (per-user ownership; 404 missing, 403 not owned)
 *
 *   GET /api/calendar-events/holiday-sprint
 *     -> 200 { offer }  the intensified sprint plan for the soonest upcoming HOLIDAY, or an
 *                       `{ available: false, plan: null }` offer when none is upcoming (Req 16.6).
 *
 * Validation (Req 16.1/16.2) and the upcoming-holiday-sprint decision (Req 16.6) are kept as
 * pure, testable functions in sibling modules ({@link ./calendarEventValidation},
 * {@link ./holidaySprint}); this module only orchestrates I/O and per-user scoping. The route
 * files wrap these handlers with `withAuth`, so unauthenticated requests are rejected with
 * 401 before any handler runs.
 */
import { CalendarEventType as PrismaCalendarEventType } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { validateCalendarEventInput } from './calendarEventValidation';
import { buildHolidaySprintOffer } from './holidaySprint';

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/** Parse an optional `from`/`to` date query param into a `Date`, or `null` when absent/invalid. */
function parseDateParam(value: string | null): Date | null {
    if (value === null || value.trim() === '') {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Handle `POST /api/calendar-events`. Validates the body via the pure
 * {@link validateCalendarEventInput} (unknown type or end-before-start -> 422, Req 16.1/16.2)
 * and persists a `CalendarEvent` scoped to the authenticated user.
 */
export async function createCalendarEventHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    if (typeof body !== 'object' || body === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must be a JSON object.',
        );
    }

    const validation = validateCalendarEventInput(body as Record<string, unknown>);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const { type, startDate, endDate } = validation.value;

    const event = await prisma.calendarEvent.create({
        data: {
            userId: auth.user.id,
            type: type as PrismaCalendarEventType,
            startDate,
            endDate,
        },
    });

    return Response.json({ event }, { status: 201 });
}

/**
 * Handle `GET /api/calendar-events?from=&to=`. Returns the authenticated user's calendar
 * events, optionally restricted to those overlapping the `[from, to]` window (an event
 * overlaps when `startDate <= to` AND `endDate >= from`). Always user-scoped.
 */
export async function listCalendarEventsHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const url = new URL(request.url);
    const from = parseDateParam(url.searchParams.get('from'));
    const to = parseDateParam(url.searchParams.get('to'));

    const where: {
        userId: string;
        startDate?: { lte: Date };
        endDate?: { gte: Date };
    } = { userId: auth.user.id };

    // Window overlap: event.startDate <= to AND event.endDate >= from.
    if (to !== null) {
        where.startDate = { lte: to };
    }
    if (from !== null) {
        where.endDate = { gte: from };
    }

    const events = await prisma.calendarEvent.findMany({
        where,
        orderBy: [{ startDate: 'asc' }, { endDate: 'asc' }],
    });

    return Response.json({ events });
}

/** Framework route context for the dynamic `/:id` segment. */
export interface CalendarEventRouteContext {
    params: { id: string };
}

/**
 * Handle `DELETE /api/calendar-events/:id`. Removes a single calendar event after enforcing
 * per-user ownership: a missing event returns 404; an event owned by another user yields 403
 * via {@link assertOwnership} (mapped by `withAuth`). On success returns `204 No Content`.
 */
export async function deleteCalendarEventHandler(
    _request: Request,
    auth: AuthContext,
    routeContext: CalendarEventRouteContext,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'An event id is required.', {
            field: 'id',
        });
    }

    const event = await prisma.calendarEvent.findUnique({
        where: { id },
        select: { id: true, userId: true },
    });

    if (!event) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Calendar event not found.');
    }

    // Cross-user delete attempt -> 403 FORBIDDEN (thrown, mapped by withAuth).
    assertOwnership(event.userId, auth.user.id);

    await prisma.calendarEvent.delete({ where: { id } });

    return new Response(null, { status: 204 });
}

/**
 * Handle `GET /api/calendar-events/holiday-sprint`. Loads the authenticated user's HOLIDAY
 * events and returns the intensified sprint offer for the soonest upcoming one, or an
 * `{ available: false, plan: null }` offer when none is upcoming (Req 16.6). The offer-building
 * decision is the pure {@link buildHolidaySprintOffer}.
 */
export async function holidaySprintHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const holidays = await prisma.calendarEvent.findMany({
        where: { userId: auth.user.id, type: PrismaCalendarEventType.HOLIDAY },
        select: { type: true, startDate: true, endDate: true },
    });

    const offer = buildHolidaySprintOffer(holidays);

    return Response.json({ offer });
}
