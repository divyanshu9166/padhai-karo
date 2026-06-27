import { describe, expect, it } from 'vitest';

import { parseDate, validateDailyAuditInput } from './auditValidation';

/**
 * DB-independent unit tests for daily-audit input validation (task 10.1; Req 14.1).
 *
 * Covers date validity, the non-negative-integer rule for plannedMin, and the optional
 * actualMin fallback. No live database is required.
 */
describe('parseDate', () => {
    it('accepts an ISO string', () => {
        const d = parseDate('2025-03-14T08:30:00.000Z');
        expect(d).toBeInstanceOf(Date);
        expect(d?.toISOString()).toBe('2025-03-14T08:30:00.000Z');
    });

    it('accepts a Date instance and epoch millis', () => {
        const now = new Date('2025-01-02T00:00:00.000Z');
        expect(parseDate(now)).toBe(now);
        expect(parseDate(now.getTime())?.getTime()).toBe(now.getTime());
    });

    it('rejects blank strings, NaN dates, and non-date types', () => {
        expect(parseDate('')).toBeNull();
        expect(parseDate('   ')).toBeNull();
        expect(parseDate('not-a-date')).toBeNull();
        expect(parseDate(Number.NaN)).toBeNull();
        expect(parseDate(undefined)).toBeNull();
        expect(parseDate(null)).toBeNull();
        expect(parseDate({})).toBeNull();
    });
});

describe('validateDailyAuditInput', () => {
    it('accepts a valid check-in without actualMin (fallback null)', () => {
        const result = validateDailyAuditInput({
            date: '2025-03-14T00:00:00.000Z',
            plannedMin: 180,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.plannedMin).toBe(180);
            expect(result.value.userEnteredActual).toBeNull();
            expect(result.value.date.toISOString()).toBe('2025-03-14T00:00:00.000Z');
        }
    });

    it('accepts a valid check-in with actualMin', () => {
        const result = validateDailyAuditInput({
            date: '2025-03-14',
            plannedMin: 120,
            actualMin: 95,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.userEnteredActual).toBe(95);
        }
    });

    it('accepts plannedMin and actualMin of zero (non-negative boundary)', () => {
        const result = validateDailyAuditInput({
            date: '2025-03-14',
            plannedMin: 0,
            actualMin: 0,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.plannedMin).toBe(0);
            expect(result.value.userEnteredActual).toBe(0);
        }
    });

    it('rejects an invalid date (422)', () => {
        const result = validateDailyAuditInput({ date: 'nope', plannedMin: 60 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'date' });
        }
    });

    it('rejects a missing plannedMin', () => {
        const result = validateDailyAuditInput({ date: '2025-03-14' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'plannedMin' });
        }
    });

    it('rejects a negative plannedMin', () => {
        const result = validateDailyAuditInput({ date: '2025-03-14', plannedMin: -1 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'plannedMin' });
        }
    });

    it('rejects a fractional plannedMin', () => {
        const result = validateDailyAuditInput({ date: '2025-03-14', plannedMin: 30.5 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'plannedMin' });
        }
    });

    it('rejects a negative or fractional actualMin when provided', () => {
        const negative = validateDailyAuditInput({
            date: '2025-03-14',
            plannedMin: 60,
            actualMin: -5,
        });
        expect(negative.ok).toBe(false);
        if (!negative.ok) {
            expect(negative.details).toEqual({ field: 'actualMin' });
        }

        const fractional = validateDailyAuditInput({
            date: '2025-03-14',
            plannedMin: 60,
            actualMin: 12.3,
        });
        expect(fractional.ok).toBe(false);
    });

    it('treats null actualMin as absent (fallback null)', () => {
        const result = validateDailyAuditInput({
            date: '2025-03-14',
            plannedMin: 60,
            actualMin: null,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.userEnteredActual).toBeNull();
        }
    });
});
