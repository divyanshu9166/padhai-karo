/**
 * Unit (example) tests for STEP 2 — calendar-event budget reshaping (Req 16.3–16.5).
 * DB-independent.
 */
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_DAILY_STUDY_HOURS,
    HOLIDAY_FACTOR,
    SCHOOL_EXAM_FACTOR,
    computeWeeklyBudget,
    weekDatesFromStart,
} from './budget';
import { CalendarEventType, type BudgetCalendarEvent } from './types';

const WEEK_START = new Date('2026-03-09T00:00:00.000Z'); // a Monday

describe('weekDatesFromStart', () => {
    it('produces seven consecutive UTC-midnight dates', () => {
        const dates = weekDatesFromStart(WEEK_START);
        expect(dates).toHaveLength(7);
        expect(dates.map((d) => d.toISOString())).toEqual([
            '2026-03-09T00:00:00.000Z',
            '2026-03-10T00:00:00.000Z',
            '2026-03-11T00:00:00.000Z',
            '2026-03-12T00:00:00.000Z',
            '2026-03-13T00:00:00.000Z',
            '2026-03-14T00:00:00.000Z',
            '2026-03-15T00:00:00.000Z',
        ]);
    });

    it('normalizes a mid-day start to UTC midnight', () => {
        const dates = weekDatesFromStart(new Date('2026-03-09T17:45:00.000Z'));
        expect(dates[0].toISOString()).toBe('2026-03-09T00:00:00.000Z');
    });
});

describe('computeWeeklyBudget', () => {
    it('with no events every day keeps the default load and W = 7 * default', () => {
        const dates = weekDatesFromStart(WEEK_START);
        const budget = computeWeeklyBudget(dates, []);
        for (const day of budget.perDay) {
            expect(day.loadHours).toBe(DEFAULT_DAILY_STUDY_HOURS);
            expect(day.excluded).toBe(false);
            expect(day.appliedEventType).toBeNull();
        }
        expect(budget.weeklyBudgetHours).toBe(7 * DEFAULT_DAILY_STUDY_HOURS);
    });

    it('a MOCK_TEST date is excluded with zero load (Req 16.5)', () => {
        const dates = weekDatesFromStart(WEEK_START);
        const events: BudgetCalendarEvent[] = [
            {
                type: CalendarEventType.MOCK_TEST,
                startDate: new Date('2026-03-11T00:00:00.000Z'),
                endDate: new Date('2026-03-11T00:00:00.000Z'),
            },
        ];
        const budget = computeWeeklyBudget(dates, events);
        const mockDay = budget.perDay[2];
        expect(mockDay.excluded).toBe(true);
        expect(mockDay.loadHours).toBe(0);
        expect(mockDay.appliedEventType).toBe(CalendarEventType.MOCK_TEST);
        // W loses exactly that day's default load.
        expect(budget.weeklyBudgetHours).toBe(6 * DEFAULT_DAILY_STUDY_HOURS);
    });

    it('a SCHOOL_EXAM date is scaled below default (Req 16.3)', () => {
        const dates = weekDatesFromStart(WEEK_START);
        const events: BudgetCalendarEvent[] = [
            {
                type: CalendarEventType.SCHOOL_EXAM,
                startDate: new Date('2026-03-10T00:00:00.000Z'),
                endDate: new Date('2026-03-10T00:00:00.000Z'),
            },
        ];
        const examDay = computeWeeklyBudget(dates, events).perDay[1];
        expect(examDay.loadHours).toBe(DEFAULT_DAILY_STUDY_HOURS * SCHOOL_EXAM_FACTOR);
        expect(examDay.loadHours).toBeLessThan(DEFAULT_DAILY_STUDY_HOURS);
        expect(examDay.excluded).toBe(false);
        expect(examDay.appliedEventType).toBe(CalendarEventType.SCHOOL_EXAM);
    });

    it('a HOLIDAY date is scaled above default (Req 16.4)', () => {
        const dates = weekDatesFromStart(WEEK_START);
        const events: BudgetCalendarEvent[] = [
            {
                type: CalendarEventType.HOLIDAY,
                startDate: new Date('2026-03-14T00:00:00.000Z'),
                endDate: new Date('2026-03-15T00:00:00.000Z'),
            },
        ];
        const budget = computeWeeklyBudget(dates, events);
        for (const idx of [5, 6]) {
            expect(budget.perDay[idx].loadHours).toBe(DEFAULT_DAILY_STUDY_HOURS * HOLIDAY_FACTOR);
            expect(budget.perDay[idx].loadHours).toBeGreaterThan(DEFAULT_DAILY_STUDY_HOURS);
            expect(budget.perDay[idx].appliedEventType).toBe(CalendarEventType.HOLIDAY);
        }
    });

    it('applies an event inclusively across its full [startDate, endDate] range', () => {
        const dates = weekDatesFromStart(WEEK_START);
        const events: BudgetCalendarEvent[] = [
            {
                type: CalendarEventType.HOLIDAY,
                // Covers Tue..Thu inclusive (indices 1..3).
                startDate: new Date('2026-03-10T00:00:00.000Z'),
                endDate: new Date('2026-03-12T00:00:00.000Z'),
            },
        ];
        const budget = computeWeeklyBudget(dates, events);
        expect(budget.perDay[0].appliedEventType).toBeNull(); // Mon, before range
        expect(budget.perDay[1].appliedEventType).toBe(CalendarEventType.HOLIDAY); // start inclusive
        expect(budget.perDay[2].appliedEventType).toBe(CalendarEventType.HOLIDAY);
        expect(budget.perDay[3].appliedEventType).toBe(CalendarEventType.HOLIDAY); // end inclusive
        expect(budget.perDay[4].appliedEventType).toBeNull(); // Fri, after range
    });

    it('matches an event by UTC day regardless of the event time of day', () => {
        const dates = weekDatesFromStart(WEEK_START);
        const events: BudgetCalendarEvent[] = [
            {
                type: CalendarEventType.MOCK_TEST,
                startDate: new Date('2026-03-11T23:30:00.000Z'),
                endDate: new Date('2026-03-11T23:30:00.000Z'),
            },
        ];
        expect(computeWeeklyBudget(dates, events).perDay[2].excluded).toBe(true);
    });

    it('resolves overlapping events by precedence: MOCK_TEST > SCHOOL_EXAM > HOLIDAY', () => {
        const dates = weekDatesFromStart(WEEK_START);
        const sameDay = new Date('2026-03-11T00:00:00.000Z');
        const events: BudgetCalendarEvent[] = [
            { type: CalendarEventType.HOLIDAY, startDate: sameDay, endDate: sameDay },
            { type: CalendarEventType.SCHOOL_EXAM, startDate: sameDay, endDate: sameDay },
            { type: CalendarEventType.MOCK_TEST, startDate: sameDay, endDate: sameDay },
        ];
        expect(computeWeeklyBudget(dates, events).perDay[2].appliedEventType).toBe(
            CalendarEventType.MOCK_TEST,
        );

        const examAndHoliday: BudgetCalendarEvent[] = [
            { type: CalendarEventType.HOLIDAY, startDate: sameDay, endDate: sameDay },
            { type: CalendarEventType.SCHOOL_EXAM, startDate: sameDay, endDate: sameDay },
        ];
        expect(computeWeeklyBudget(dates, examAndHoliday).perDay[2].appliedEventType).toBe(
            CalendarEventType.SCHOOL_EXAM,
        );
    });

    it('honors a custom default daily load', () => {
        const dates = weekDatesFromStart(WEEK_START);
        const budget = computeWeeklyBudget(dates, [], { defaultDailyHours: 4 });
        expect(budget.weeklyBudgetHours).toBe(28);
        expect(budget.perDay[0].loadHours).toBe(4);
    });
});
