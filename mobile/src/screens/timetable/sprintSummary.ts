/**
 * Holiday-sprint presentation helper (task 21.3; Req 16.6).
 *
 * The Backend_API surfaces an intensified holiday study sprint plan for the soonest upcoming
 * HOLIDAY Calendar_Event (`GET /calendar-events/holiday-sprint`). This pure module turns that
 * plan into the small set of display values the timetable banner shows, so the formatting is
 * dependency-free and unit-testable without a React Native runtime.
 */
import type { HolidaySprintPlan } from '@/api';
import { formatDayMonth } from './dateUtils';

/** Display-ready fields for the holiday-sprint banner. */
export interface SprintSummary {
    /** A `1 Jun – 10 Jun` style UTC date range for the holiday period. */
    range: string;
    /** Whole number of holiday days in the sprint. */
    days: number;
    /** Suggested intensified daily study hours, rounded to one decimal place. */
    dailyHours: number;
}

/** Round to one decimal place, dropping a trailing `.0` so whole numbers read cleanly. */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/** Build the display summary for a holiday-sprint plan (Req 16.6). */
export function summarizeSprint(plan: HolidaySprintPlan): SprintSummary {
    return {
        range: `${formatDayMonth(new Date(plan.startDate))} – ${formatDayMonth(new Date(plan.endDate))}`,
        days: plan.days,
        dailyHours: round1(plan.suggestedDailyHours),
    };
}
