/**
 * STEP 2 of the timetable-generation pipeline — compute the week's study budget and reshape
 * it by calendar events (Req 16.3, 16.4, 16.5).
 *
 * Pure, database-free logic: begin from a default daily study load and, for each date in the
 * target week, reshape that day's load by any applicable `CalendarEvent`:
 *
 *   - `MOCK_TEST`   → the date is removed from regular scheduling entirely; load 0 (Req 16.5).
 *   - `SCHOOL_EXAM` → daily load scaled DOWN by {@link SCHOOL_EXAM_FACTOR} (< 1)   (Req 16.3).
 *   - `HOLIDAY`     → daily load scaled UP by {@link HOLIDAY_FACTOR}   (> 1)        (Req 16.4).
 *   - otherwise     → the default daily load.
 *
 * Summing the reshaped per-day loads gives the weekly study budget `W` (in hours).
 *
 * Dates are compared at UTC-day granularity (consistent with the dashboard, task 9.1, and
 * the daily audit, task 10.1). A calendar event applies to a date when the date falls within
 * `[startDate, endDate]` INCLUSIVE.
 */
import { startOfUtcDay } from '@/services/dashboard';

import {
    CalendarEventType,
    DAYS_OF_WEEK,
    type BudgetCalendarEvent,
    type DayLoad,
    type DayOfWeek,
    type WeeklyBudget,
} from './types';

/**
 * Reduction factor applied to the default daily load on a `SCHOOL_EXAM` date (Req 16.3).
 * Strictly `< 1` so exam days are scheduled with less study load than a default day.
 */
export const SCHOOL_EXAM_FACTOR = 0.5;

/**
 * Increase factor applied to the default daily load on a `HOLIDAY` date (Req 16.4).
 * Strictly `> 1` so holidays are scheduled with more study load than a default day.
 */
export const HOLIDAY_FACTOR = 1.5;

/**
 * Default daily study load (hours) used when the caller does not supply the user's
 * preferred daily load. Reshaping scales relative to this baseline.
 */
export const DEFAULT_DAILY_STUDY_HOURS = 6;

/** Options accepted by {@link computeWeeklyBudget}. */
export interface WeeklyBudgetOptions {
    /** The user's baseline daily study load in hours (defaults to {@link DEFAULT_DAILY_STUDY_HOURS}). */
    defaultDailyHours?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Precedence for resolving a date covered by more than one event type. `MOCK_TEST` wins
 * (the date is removed regardless of other events); a `SCHOOL_EXAM` reduction takes
 * precedence over a `HOLIDAY` increase so an exam day stays conservative. A plain day with
 * no covering event keeps the default load.
 */
const EVENT_PRECEDENCE: readonly CalendarEventType[] = [
    CalendarEventType.MOCK_TEST,
    CalendarEventType.SCHOOL_EXAM,
    CalendarEventType.HOLIDAY,
];

/** True when `date`'s UTC day falls within `[event.startDate, event.endDate]` inclusive. */
function eventCoversDate(event: BudgetCalendarEvent, date: Date): boolean {
    const day = startOfUtcDay(date).getTime();
    const start = startOfUtcDay(event.startDate).getTime();
    const end = startOfUtcDay(event.endDate).getTime();
    return day >= start && day <= end;
}

/**
 * Determine the single dominant event type for a date, applying {@link EVENT_PRECEDENCE},
 * or `null` when no event covers the date.
 */
function dominantEventType(
    events: ReadonlyArray<BudgetCalendarEvent>,
    date: Date,
): CalendarEventType | null {
    const covering = new Set<CalendarEventType>();
    for (const event of events) {
        if (eventCoversDate(event, date)) {
            covering.add(event.type);
        }
    }
    for (const type of EVENT_PRECEDENCE) {
        if (covering.has(type)) {
            return type;
        }
    }
    return null;
}

/** Reshape a single date's load given its dominant covering event type (if any). */
function reshapeDayLoad(
    date: Date,
    defaultDailyHours: number,
    appliedEventType: CalendarEventType | null,
): DayLoad {
    const normalizedDate = startOfUtcDay(date);
    const dayOfWeek = normalizedDate.getUTCDay() as DayOfWeek;
    const base = {
        date: normalizedDate,
        dayOfWeek,
        appliedEventType,
    };

    switch (appliedEventType) {
        case CalendarEventType.MOCK_TEST:
            return { ...base, loadHours: 0, excluded: true };
        case CalendarEventType.SCHOOL_EXAM:
            return { ...base, loadHours: defaultDailyHours * SCHOOL_EXAM_FACTOR, excluded: false };
        case CalendarEventType.HOLIDAY:
            return { ...base, loadHours: defaultDailyHours * HOLIDAY_FACTOR, excluded: false };
        default:
            return { ...base, loadHours: defaultDailyHours, excluded: false };
    }
}

/**
 * Generate the seven consecutive UTC-midnight dates of a target week starting at
 * `weekStart`. The first element is `startOfUtcDay(weekStart)`.
 */
export function weekDatesFromStart(weekStart: Date): Date[] {
    const start = startOfUtcDay(weekStart);
    return DAYS_OF_WEEK.map((offset) => new Date(start.getTime() + offset * MS_PER_DAY));
}

/**
 * Compute the week's study budget reshaped by calendar events (Req 16.3–16.5, pipeline
 * STEP 2).
 *
 * @param weekDates The dates of the target week (typically seven; e.g. {@link weekDatesFromStart}).
 * @param events    The calendar events to apply; an event covers a date inclusively.
 * @param options   Baseline daily load; defaults to {@link DEFAULT_DAILY_STUDY_HOURS}.
 * @returns The reshaped per-day loads and the weekly study budget `W` (their sum).
 */
export function computeWeeklyBudget(
    weekDates: ReadonlyArray<Date>,
    events: ReadonlyArray<BudgetCalendarEvent> = [],
    options: WeeklyBudgetOptions = {},
): WeeklyBudget {
    const defaultDailyHours = options.defaultDailyHours ?? DEFAULT_DAILY_STUDY_HOURS;

    const perDay = weekDates.map((date) =>
        reshapeDayLoad(date, defaultDailyHours, dominantEventType(events, date)),
    );

    const weeklyBudgetHours = perDay.reduce((total, day) => total + day.loadHours, 0);

    return { perDay, weeklyBudgetHours };
}
