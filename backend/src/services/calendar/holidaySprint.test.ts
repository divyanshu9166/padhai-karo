/**
 * Unit tests for the pure holiday-sprint offer builder (task 6.7; Req 16.6).
 *
 * DB-independent example/edge-case tests: an upcoming holiday produces an intensified offer
 * (daily load scaled by HOLIDAY_FACTOR), and no upcoming holiday produces the empty offer.
 */
import { describe, expect, it } from 'vitest';

import { CalendarEventType, DEFAULT_DAILY_STUDY_HOURS, HOLIDAY_FACTOR } from '@/lib/timetable';

import { NO_SPRINT_OFFER, buildHolidaySprintOffer } from './holidaySprint';

const NOW = new Date('2026-05-01T12:00:00.000Z');

function holiday(startDate: string, endDate: string) {
    return {
        type: CalendarEventType.HOLIDAY,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
    };
}

describe('buildHolidaySprintOffer', () => {
    it('offers an intensified sprint for an upcoming holiday using HOLIDAY_FACTOR (Req 16.6)', () => {
        const offer = buildHolidaySprintOffer([holiday('2026-06-01', '2026-06-10')], {
            now: NOW,
        });

        expect(offer.available).toBe(true);
        if (offer.available) {
            expect(offer.plan.days).toBe(10);
            expect(offer.plan.holidayFactor).toBe(HOLIDAY_FACTOR);
            expect(offer.plan.defaultDailyHours).toBe(DEFAULT_DAILY_STUDY_HOURS);
            expect(offer.plan.suggestedDailyHours).toBe(
                DEFAULT_DAILY_STUDY_HOURS * HOLIDAY_FACTOR,
            );
            expect(offer.plan.suggestedTotalHours).toBe(
                DEFAULT_DAILY_STUDY_HOURS * HOLIDAY_FACTOR * 10,
            );
            expect(offer.plan.startDate.toISOString()).toBe('2026-06-01T00:00:00.000Z');
            expect(offer.plan.endDate.toISOString()).toBe('2026-06-10T00:00:00.000Z');
        }
    });

    it('honors a custom default daily load', () => {
        const offer = buildHolidaySprintOffer([holiday('2026-06-01', '2026-06-01')], {
            now: NOW,
            defaultDailyHours: 8,
        });

        expect(offer.available).toBe(true);
        if (offer.available) {
            expect(offer.plan.days).toBe(1);
            expect(offer.plan.suggestedDailyHours).toBe(8 * HOLIDAY_FACTOR);
        }
    });

    it('includes a holiday already in progress (end still in the future)', () => {
        const offer = buildHolidaySprintOffer([holiday('2026-04-28', '2026-05-05')], {
            now: NOW,
        });
        expect(offer.available).toBe(true);
    });

    it('chooses the soonest-starting upcoming holiday', () => {
        const offer = buildHolidaySprintOffer(
            [holiday('2026-08-01', '2026-08-05'), holiday('2026-06-01', '2026-06-03')],
            { now: NOW },
        );

        expect(offer.available).toBe(true);
        if (offer.available) {
            expect(offer.plan.startDate.toISOString()).toBe('2026-06-01T00:00:00.000Z');
        }
    });

    it('returns the empty offer when no holiday is upcoming (Req 16.6)', () => {
        const offer = buildHolidaySprintOffer([holiday('2026-01-01', '2026-01-10')], {
            now: NOW,
        });
        expect(offer).toEqual(NO_SPRINT_OFFER);
        expect(offer.available).toBe(false);
        expect(offer.plan).toBeNull();
    });

    it('ignores non-holiday events and returns the empty offer when none qualify', () => {
        const offer = buildHolidaySprintOffer(
            [
                {
                    type: CalendarEventType.SCHOOL_EXAM,
                    startDate: new Date('2026-06-01'),
                    endDate: new Date('2026-06-10'),
                },
            ],
            { now: NOW },
        );
        expect(offer).toEqual(NO_SPRINT_OFFER);
    });

    it('returns the empty offer for an empty event list', () => {
        expect(buildHolidaySprintOffer([], { now: NOW })).toEqual(NO_SPRINT_OFFER);
    });
});
