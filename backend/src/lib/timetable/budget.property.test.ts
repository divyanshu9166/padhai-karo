/**
 * Property-based test for STEP 2 — calendar-event budget reshaping (`./budget`) together with
 * calendar-event date-range validation (`@/services/calendar/calendarEventValidation`).
 *
 *   - Property 20 (task 6.21): calendar-event load reshaping (Req 16.2–16.5).
 *
 * A single fast-check assertion running the global >= 100 iterations (vitest.setup.ts): every
 * school-exam date is scheduled below the user's default load, every holiday date above it,
 * every mock-test date is excluded from regular study, and any event whose end date precedes
 * its start date is rejected.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateCalendarEventInput } from '@/services/calendar/calendarEventValidation';

import { computeWeeklyBudget, weekDatesFromStart } from './budget';
import { CalendarEventType, type BudgetCalendarEvent } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_TYPE_POOL = [
    CalendarEventType.SCHOOL_EXAM,
    CalendarEventType.HOLIDAY,
    CalendarEventType.MOCK_TEST,
] as const;

describe('Property 20: Calendar-event load reshaping', () => {
    // Feature: jee-neet-study-app, Property 20: For any week with calendar events, every date inside a school-exam event has generated daily load below the user's default, every date inside a holiday event has load above the default, and every mock-test date has no regular study blocks; and any calendar event whose end date precedes its start date is rejected.
    it('reshapes per-day load by event type and rejects end-before-start events (Req 16.2-16.5)', () => {
        fc.assert(
            fc.property(
                fc.date({
                    min: new Date('2026-01-01T00:00:00.000Z'),
                    max: new Date('2027-12-31T00:00:00.000Z'),
                }),
                // One optional single-day event per weekday index (0..6).
                fc.array(fc.option(fc.constantFrom(...EVENT_TYPE_POOL), { nil: null }), {
                    minLength: 7,
                    maxLength: 7,
                }),
                fc.integer({ min: 1, max: 12 }), // the user's default daily load
                (weekStart, perDayEventTypes, defaultDailyHours) => {
                    const weekDates = weekDatesFromStart(weekStart);
                    const events: BudgetCalendarEvent[] = [];
                    perDayEventTypes.forEach((type, index) => {
                        if (type) {
                            events.push({ type, startDate: weekDates[index], endDate: weekDates[index] });
                        }
                    });

                    const budget = computeWeeklyBudget(weekDates, events, { defaultDailyHours });

                    budget.perDay.forEach((day, index) => {
                        const type = perDayEventTypes[index];
                        switch (type) {
                            case CalendarEventType.SCHOOL_EXAM:
                                // Below the user's default (Req 16.3).
                                expect(day.loadHours).toBeLessThan(defaultDailyHours);
                                expect(day.excluded).toBe(false);
                                break;
                            case CalendarEventType.HOLIDAY:
                                // Above the user's default (Req 16.4).
                                expect(day.loadHours).toBeGreaterThan(defaultDailyHours);
                                expect(day.excluded).toBe(false);
                                break;
                            case CalendarEventType.MOCK_TEST:
                                // Removed from regular scheduling: no study load (Req 16.5).
                                expect(day.excluded).toBe(true);
                                expect(day.loadHours).toBe(0);
                                break;
                            default:
                                // A plain day keeps the default load.
                                expect(day.loadHours).toBe(defaultDailyHours);
                        }
                    });

                    // Req 16.2: an event whose end date precedes its start date is rejected.
                    const rejected = validateCalendarEventInput({
                        type: CalendarEventType.HOLIDAY,
                        startDate: weekDates[1],
                        endDate: new Date(weekDates[1].getTime() - MS_PER_DAY),
                    });
                    expect(rejected.ok).toBe(false);

                    // A same-or-later end date is accepted (single-day events are valid).
                    const accepted = validateCalendarEventInput({
                        type: CalendarEventType.HOLIDAY,
                        startDate: weekDates[0],
                        endDate: weekDates[0],
                    });
                    expect(accepted.ok).toBe(true);
                },
            ),
        );
    });
});
