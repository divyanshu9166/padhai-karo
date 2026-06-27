/**
 * Pure "holiday study sprint" offer builder (task 6.7; design "Holiday and School Exam
 * Mode"; Req 16.6).
 *
 * Req 16.6: WHERE a Holiday Calendar_Event is upcoming, the Backend_API offers an
 * intensified holiday study sprint plan for the Holiday period. This module isolates the
 * "is there an upcoming holiday + build the offer" decision as a pure, database-free
 * function so it can be unit-tested without a live DB and reused by the thin route handler.
 *
 * "Upcoming" semantics (UTC-day granularity, consistent with the budget reshaper, dashboard,
 * and daily audit): a HOLIDAY event is upcoming when its `endDate` UTC day is on or after
 * "today" — i.e. the holiday has not fully elapsed yet. This deliberately includes a holiday
 * that is already in progress (its end is still in the future), since the sprint plan remains
 * useful for the remainder of the period. When several holidays qualify, the one starting
 * soonest is chosen (ties broken by the earlier end date).
 *
 * The sprint's daily-load suggestion reuses {@link HOLIDAY_FACTOR} from the timetable budget
 * library so the offer stays in lockstep with how the generator actually reshapes holiday
 * load (Req 16.4) — there is a single source of truth and no drift.
 */
import { startOfUtcDay } from '@/services/dashboard';

import {
    CalendarEventType,
    DEFAULT_DAILY_STUDY_HOURS,
    HOLIDAY_FACTOR,
} from '@/lib/timetable';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The minimal shape of a holiday-candidate event the builder consumes. */
export interface SprintCandidateEvent {
    type: CalendarEventType;
    /** First UTC day the event covers (inclusive). */
    startDate: Date;
    /** Last UTC day the event covers (inclusive). */
    endDate: Date;
}

/** Options for {@link buildHolidaySprintOffer}. */
export interface HolidaySprintOptions {
    /** "Now" reference instant; defaults to the current time. Compared at UTC-day granularity. */
    now?: Date;
    /** The user's baseline daily study load in hours (defaults to {@link DEFAULT_DAILY_STUDY_HOURS}). */
    defaultDailyHours?: number;
}

/** The intensified sprint plan offered for an upcoming holiday period (Req 16.6). */
export interface HolidaySprintPlan {
    /** First UTC day of the holiday period (inclusive). */
    startDate: Date;
    /** Last UTC day of the holiday period (inclusive). */
    endDate: Date;
    /** Inclusive number of days the holiday spans (>= 1). */
    days: number;
    /** The user's baseline daily study load used to derive the suggestion. */
    defaultDailyHours: number;
    /** The increase factor applied to the baseline ({@link HOLIDAY_FACTOR}, Req 16.4). */
    holidayFactor: number;
    /** Suggested intensified daily study load (`defaultDailyHours * holidayFactor`). */
    suggestedDailyHours: number;
    /** Suggested total study load across the whole holiday period (`suggestedDailyHours * days`). */
    suggestedTotalHours: number;
}

/**
 * The offer envelope. `available` is `false` with `plan: null` when no holiday is upcoming,
 * so callers get a stable shape they can branch on without optional chaining surprises.
 */
export type HolidaySprintOffer =
    | { available: true; plan: HolidaySprintPlan }
    | { available: false; plan: null };

/** The stable "no upcoming holiday" offer (Req 16.6). */
export const NO_SPRINT_OFFER: HolidaySprintOffer = { available: false, plan: null };

/** Inclusive day span between two UTC-midnight dates (both ends counted); minimum 1. */
function inclusiveDays(startDay: Date, endDay: Date): number {
    return Math.floor((endDay.getTime() - startDay.getTime()) / MS_PER_DAY) + 1;
}

/**
 * Build the intensified holiday-sprint offer for the soonest upcoming HOLIDAY event, or
 * {@link NO_SPRINT_OFFER} when none is upcoming (Req 16.6).
 *
 * A HOLIDAY event is "upcoming" when its `endDate` UTC day is on or after today's UTC day.
 * Among upcoming holidays the one with the earliest `startDate` is selected (ties broken by
 * the earlier `endDate`). The suggested daily load is the baseline scaled by
 * {@link HOLIDAY_FACTOR} (Req 16.4), keeping the offer aligned with the generator's reshaping.
 *
 * Pure: performs no I/O. The caller loads the user's HOLIDAY events and passes them in.
 */
export function buildHolidaySprintOffer(
    events: ReadonlyArray<SprintCandidateEvent>,
    options: HolidaySprintOptions = {},
): HolidaySprintOffer {
    const today = startOfUtcDay(options.now ?? new Date()).getTime();
    const defaultDailyHours = options.defaultDailyHours ?? DEFAULT_DAILY_STUDY_HOURS;

    const upcomingHolidays = events
        .filter((event) => event.type === CalendarEventType.HOLIDAY)
        .map((event) => ({
            startDay: startOfUtcDay(event.startDate),
            endDay: startOfUtcDay(event.endDate),
        }))
        .filter((event) => event.endDay.getTime() >= today);

    if (upcomingHolidays.length === 0) {
        return NO_SPRINT_OFFER;
    }

    // Soonest-starting holiday wins; ties broken by the earlier end date.
    upcomingHolidays.sort((a, b) => {
        const byStart = a.startDay.getTime() - b.startDay.getTime();
        return byStart !== 0 ? byStart : a.endDay.getTime() - b.endDay.getTime();
    });

    const chosen = upcomingHolidays[0];
    const days = inclusiveDays(chosen.startDay, chosen.endDay);
    const suggestedDailyHours = defaultDailyHours * HOLIDAY_FACTOR;

    return {
        available: true,
        plan: {
            startDate: chosen.startDay,
            endDate: chosen.endDay,
            days,
            defaultDailyHours,
            holidayFactor: HOLIDAY_FACTOR,
            suggestedDailyHours,
            suggestedTotalHours: suggestedDailyHours * days,
        },
    };
}
