/**
 * Pure validation for the Calendar-Event service (task 6.7; design "Timetable Generation
 * Service" / "Holiday and School Exam Mode"; Req 16.1, 16.2).
 *
 * The calendar-event create endpoint accepts an untrusted `{ type, startDate, endDate }`
 * body. This module holds the framework- and database-free decision logic so it can be
 * unit-tested in isolation (no live DB required) and reused by the thin route handler:
 *
 *   - `type` must be one of the known {@link CalendarEventType} values (SCHOOL_EXAM /
 *     HOLIDAY / MOCK_TEST); anything else is a validation error (Req 16.1).
 *   - `startDate` and `endDate` must be parseable date-times.
 *   - The event covers `[startDate, endDate]` INCLUSIVE at UTC-day granularity (consistent
 *     with the budget reshaper, dashboard, and daily audit). An `endDate` whose UTC day is
 *     EARLIER than the `startDate` UTC day is rejected (Req 16.2); an equal day (a
 *     single-day event) is valid.
 *
 * Pure: performs no I/O and never touches the database, so the caller (the route handler)
 * owns persistence and per-user scoping.
 */
import { startOfUtcDay } from '@/services/dashboard';

import { CalendarEventType } from '@/lib/timetable';

/** All valid {@link CalendarEventType} values, for rejecting unknown types without a DB hit. */
export const CALENDAR_EVENT_TYPES: readonly CalendarEventType[] = [
    CalendarEventType.SCHOOL_EXAM,
    CalendarEventType.HOLIDAY,
    CalendarEventType.MOCK_TEST,
];

/** Raw, untrusted calendar-event input as received from the request body. */
export interface CalendarEventInput {
    type?: unknown;
    startDate?: unknown;
    endDate?: unknown;
}

/** A validated, normalized calendar event ready to persist (dates normalized to UTC midnight). */
export interface ValidatedCalendarEvent {
    type: CalendarEventType;
    startDate: Date;
    endDate: Date;
}

/** Discriminated result of {@link validateCalendarEventInput}. */
export type CalendarEventValidation =
    | { ok: true; value: ValidatedCalendarEvent }
    | { ok: false; message: string; details?: Record<string, unknown> };

/**
 * Coerce an incoming date (ISO string, epoch millis, or `Date`) into a valid `Date`, or
 * `null` when it cannot be parsed. Blank strings and `NaN` dates are rejected rather than
 * silently becoming the epoch or "now".
 */
function parseDate(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

/**
 * True when `type` is one of the known {@link CalendarEventType} values (Req 16.1). Exposed
 * for reuse/testing alongside {@link validateCalendarEventInput}.
 */
export function isKnownCalendarEventType(type: unknown): type is CalendarEventType {
    return typeof type === 'string' && (CALENDAR_EVENT_TYPES as string[]).includes(type);
}

/**
 * Validate and normalize a calendar-event create request (Req 16.1, 16.2).
 *
 * Checks, in order:
 *   1. `type` is a known calendar-event type (Req 16.1).
 *   2. `startDate` and `endDate` are parseable date-times.
 *   3. The `endDate` UTC day is not earlier than the `startDate` UTC day (Req 16.2). A
 *      single-day event (equal UTC days) is valid.
 *
 * On success the returned dates are normalized to UTC midnight so persistence and the
 * downstream budget reshaper share the same `[startDate, endDate]` inclusive day semantics.
 */
export function validateCalendarEventInput(input: CalendarEventInput): CalendarEventValidation {
    // 1. Type must be a known value (Req 16.1).
    if (!isKnownCalendarEventType(input.type)) {
        return {
            ok: false,
            message: `"type" must be one of: ${CALENDAR_EVENT_TYPES.join(', ')}.`,
            details: { field: 'type' },
        };
    }

    // 2. Start/end must be valid date-times.
    const startDate = parseDate(input.startDate);
    if (startDate === null) {
        return {
            ok: false,
            message: '"startDate" must be a valid date.',
            details: { field: 'startDate' },
        };
    }
    const endDate = parseDate(input.endDate);
    if (endDate === null) {
        return {
            ok: false,
            message: '"endDate" must be a valid date.',
            details: { field: 'endDate' },
        };
    }

    // 3. endDate may not be earlier than startDate, compared at UTC-day granularity (Req 16.2).
    const startDay = startOfUtcDay(startDate);
    const endDay = startOfUtcDay(endDate);
    if (endDay.getTime() < startDay.getTime()) {
        return {
            ok: false,
            message: '"endDate" cannot be earlier than "startDate".',
            details: { field: 'endDate' },
        };
    }

    return {
        ok: true,
        value: { type: input.type, startDate: startDay, endDate: endDay },
    };
}
