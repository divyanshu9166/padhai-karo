/**
 * Unit tests for the pure calendar-event validation logic (task 6.7; Req 16.1, 16.2).
 *
 * DB-independent example/edge-case tests for the decision logic only. The numbered property
 * test for calendar-event load reshaping (Property 20, task 6.21) is a worker/budget concern
 * tested elsewhere and is intentionally not implemented here.
 */
import { describe, expect, it } from 'vitest';

import {
    CALENDAR_EVENT_TYPES,
    isKnownCalendarEventType,
    validateCalendarEventInput,
} from './calendarEventValidation';

describe('isKnownCalendarEventType', () => {
    it('accepts each known calendar-event type (Req 16.1)', () => {
        for (const type of CALENDAR_EVENT_TYPES) {
            expect(isKnownCalendarEventType(type)).toBe(true);
        }
    });

    it('rejects unknown / non-string types', () => {
        for (const value of ['EXAM', 'holiday', '', 1, null, undefined, {}]) {
            expect(isKnownCalendarEventType(value)).toBe(false);
        }
    });
});

describe('validateCalendarEventInput', () => {
    it('accepts a valid multi-day event and normalizes dates to UTC midnight (Req 16.1)', () => {
        const result = validateCalendarEventInput({
            type: 'HOLIDAY',
            startDate: '2026-05-01T09:30:00.000Z',
            endDate: '2026-05-10T18:00:00.000Z',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.type).toBe('HOLIDAY');
            expect(result.value.startDate.toISOString()).toBe('2026-05-01T00:00:00.000Z');
            expect(result.value.endDate.toISOString()).toBe('2026-05-10T00:00:00.000Z');
        }
    });

    it('accepts a single-day event where start and end fall on the same UTC day (Req 16.2)', () => {
        const result = validateCalendarEventInput({
            type: 'MOCK_TEST',
            startDate: '2026-05-01T02:00:00.000Z',
            endDate: '2026-05-01T22:00:00.000Z',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.startDate.getTime()).toBe(result.value.endDate.getTime());
        }
    });

    it('rejects an unknown type (Req 16.1)', () => {
        const result = validateCalendarEventInput({
            type: 'VACATION',
            startDate: '2026-05-01',
            endDate: '2026-05-02',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'type' });
        }
    });

    it('rejects an end date earlier than the start date (Req 16.2)', () => {
        const result = validateCalendarEventInput({
            type: 'SCHOOL_EXAM',
            startDate: '2026-05-10T00:00:00.000Z',
            endDate: '2026-05-01T00:00:00.000Z',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'endDate' });
        }
    });

    it('rejects an unparseable start date', () => {
        const result = validateCalendarEventInput({
            type: 'HOLIDAY',
            startDate: 'not-a-date',
            endDate: '2026-05-02',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'startDate' });
        }
    });

    it('rejects a missing end date', () => {
        const result = validateCalendarEventInput({
            type: 'HOLIDAY',
            startDate: '2026-05-01',
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'endDate' });
        }
    });
});
