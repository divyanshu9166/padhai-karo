/**
 * Unit tests for the holiday-sprint presentation helper (task 21.3; Req 16.6).
 *
 * Verify the pure summary turns a Backend_API holiday-sprint plan into the display values the
 * banner shows: a UTC date range, the day count, and the suggested intensified daily hours
 * rounded to one decimal.
 */
import { describe, expect, it } from 'vitest';

import type { HolidaySprintPlan } from '../../api/timetable';
import { summarizeSprint } from './sprintSummary';

function plan(overrides: Partial<HolidaySprintPlan> = {}): HolidaySprintPlan {
    return {
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-10T00:00:00.000Z',
        days: 10,
        defaultDailyHours: 6,
        holidayFactor: 1.5,
        suggestedDailyHours: 9,
        suggestedTotalHours: 90,
        ...overrides,
    };
}

describe('summarizeSprint (Req 16.6)', () => {
    it('formats the holiday date range in UTC', () => {
        expect(summarizeSprint(plan()).range).toBe('1 Jun – 10 Jun');
    });

    it('passes through the whole day count', () => {
        expect(summarizeSprint(plan({ days: 3 })).days).toBe(3);
    });

    it('rounds the suggested daily hours to one decimal place', () => {
        expect(summarizeSprint(plan({ suggestedDailyHours: 8 * 1.5 })).dailyHours).toBe(12);
        expect(summarizeSprint(plan({ suggestedDailyHours: 6.25 })).dailyHours).toBe(6.3);
    });
});
