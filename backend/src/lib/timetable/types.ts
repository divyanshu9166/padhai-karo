/**
 * Shared types and constants for the deterministic timetable-generation pipeline
 * (task group 6, Req 3, 11, 12.3, 13, 14.5, 15, 16, 17).
 *
 * These types are framework- and database-free so every pipeline step can be a pure,
 * composable function of plain inputs. Step 1 (free-time grid) and Step 2 (calendar-event
 * budget reshaping) are implemented in `./grid` and `./budget`; later steps (3–9) build on
 * the same vocabulary defined here.
 *
 * Time-of-day is represented as MINUTES SINCE LOCAL MIDNIGHT (0–1440) so interval math is
 * trivial integer arithmetic, matching the "HH:mm" storage of `FixedCommitment`. Calendar
 * dates use UTC day boundaries to stay consistent with the dashboard (task 9.1) and daily
 * audit (task 10.1).
 */

/** Slot granularity for the free-time grid and all scheduling: 30 minutes (Req 3.1). */
export const SLOT_MINUTES = 30;

/** Number of minutes in a full day; an interval end may equal this (exclusive midnight). */
export const MINUTES_PER_DAY = 24 * 60;

/**
 * Day of week, `0` (Sunday) – `6` (Saturday). Mirrors `FixedCommitment.dayOfWeek` and
 * JavaScript's `Date.getUTCDay()`.
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** All seven day-of-week indices in order, for iterating a full week grid. */
export const DAYS_OF_WEEK: readonly DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * A half-open interval of minutes-since-midnight `[startMinute, endMinute)`. Used for both
 * the per-day waking window and the free intervals carved out of it.
 */
export interface MinuteInterval {
    /** Inclusive start, minutes since local midnight (0–1440). */
    startMinute: number;
    /** Exclusive end, minutes since local midnight (0–1440); strictly greater than start. */
    endMinute: number;
}

/**
 * The daily waking window bounding all schedulable time, expressed as "HH:mm" 24-hour
 * strings. The same window applies to every weekday.
 */
export interface WakingWindow {
    /** Earliest schedulable time, "HH:mm". */
    start: string;
    /** Latest schedulable time, "HH:mm"; must be strictly later than `start`. */
    end: string;
}

/**
 * The minimal shape of a `FixedCommitment` the free-time grid consumes (Req 3.1): a
 * recurring weekly unavailable block. Extra fields on the persisted model (label, id, …)
 * are irrelevant to interval subtraction and intentionally omitted.
 */
export interface GridCommitment {
    /** Day of week the commitment recurs on, 0 (Sunday) – 6 (Saturday). */
    dayOfWeek: number;
    /** Local start time, "HH:mm". */
    startTime: string;
    /** Local end time, "HH:mm". */
    endTime: string;
}

/** The set of free (schedulable) intervals for a single weekday. */
export interface DayFreeIntervals {
    dayOfWeek: DayOfWeek;
    /** Non-overlapping, ascending, 30-min-aligned free intervals (may be empty). */
    intervals: MinuteInterval[];
}

/**
 * The full week's free-time grid: exactly seven entries, indexed by and ordered by
 * `dayOfWeek` (0 = Sunday … 6 = Saturday). The free intervals of any day never overlap a
 * `FixedCommitment` on that day (Req 3.1).
 */
export type FreeTimeGrid = DayFreeIntervals[];

/** Calendar-event type, mirroring the Prisma `CalendarEventType` enum (Req 16). */
export const CalendarEventType = {
    SCHOOL_EXAM: 'SCHOOL_EXAM',
    HOLIDAY: 'HOLIDAY',
    MOCK_TEST: 'MOCK_TEST',
} as const;

export type CalendarEventType = (typeof CalendarEventType)[keyof typeof CalendarEventType];

/**
 * The minimal shape of a `CalendarEvent` the budget reshaper consumes (Req 16). An event
 * applies to a date when the date falls within `[startDate, endDate]` INCLUSIVE, compared
 * at UTC-day granularity.
 */
export interface BudgetCalendarEvent {
    type: CalendarEventType;
    /** First UTC day the event covers (inclusive). */
    startDate: Date;
    /** Last UTC day the event covers (inclusive); should be on/after `startDate`. */
    endDate: Date;
}

/** The reshaped study load for a single date of the target week (Req 16.3–16.5). */
export interface DayLoad {
    /** The date, normalized to UTC midnight. */
    date: Date;
    /** The day of week (UTC), 0 (Sunday) – 6 (Saturday), for mapping back to the grid. */
    dayOfWeek: DayOfWeek;
    /** The reshaped study load in hours for this date (0 when excluded). */
    loadHours: number;
    /** True when the date is removed from regular scheduling entirely (Mock_Test, Req 16.5). */
    excluded: boolean;
    /** Which calendar-event type reshaped this date, or `null` for a plain default day. */
    appliedEventType: CalendarEventType | null;
}

/** The week's study budget: the reshaped per-day loads and their sum `W` (Req 16). */
export interface WeeklyBudget {
    /** The seven reshaped day loads, in chronological order. */
    perDay: DayLoad[];
    /** The weekly study budget `W` in hours: the sum of every day's reshaped load. */
    weeklyBudgetHours: number;
}
