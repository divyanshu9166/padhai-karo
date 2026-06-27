/**
 * Unit tests for the pure chapter override validation logic (task 5.2; Req 11.3).
 *
 * DB- and framework-independent example/edge-case tests for the positive-number checks and
 * partial-update behaviour of the override patch body. No live database is touched.
 *
 * Validates: Requirements 11.3
 */
import { describe, expect, it } from 'vitest';

import { validateChapterOverrideInput } from './overrideValidation';

describe('validateChapterOverrideInput', () => {
    it('accepts a single provided positive override field', () => {
        const result = validateChapterOverrideInput({ weightageOverride: 12.5 });
        expect(result).toEqual({ ok: true, value: { weightageOverride: 12.5 } });
    });

    it('accepts all three override fields together', () => {
        const result = validateChapterOverrideInput({
            weightageOverride: 8,
            estHoursOverride: 10,
            timeAllocationOverride: 4.5,
        });
        expect(result).toEqual({
            ok: true,
            value: { weightageOverride: 8, estHoursOverride: 10, timeAllocationOverride: 4.5 },
        });
    });

    it('keeps only the provided fields (partial update)', () => {
        const result = validateChapterOverrideInput({ estHoursOverride: 6 });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({ estHoursOverride: 6 });
            expect(Object.keys(result.value)).toEqual(['estHoursOverride']);
        }
    });

    it('ignores unknown extra keys', () => {
        const result = validateChapterOverrideInput({
            timeAllocationOverride: 3,
            bogus: 'nope',
            id: 'x',
        });
        expect(result).toEqual({ ok: true, value: { timeAllocationOverride: 3 } });
    });

    it('rejects an empty patch with no override fields', () => {
        const result = validateChapterOverrideInput({});
        expect(result.ok).toBe(false);
    });

    it('rejects a body that is not a JSON object', () => {
        for (const body of [undefined, null, 'str', 42, [], true]) {
            expect(validateChapterOverrideInput(body).ok).toBe(false);
        }
    });

    it('rejects zero and negative numbers (must be strictly positive)', () => {
        for (const bad of [0, -1, -0.5]) {
            const result = validateChapterOverrideInput({ weightageOverride: bad });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toEqual({ field: 'weightageOverride' });
            }
        }
    });

    it('rejects non-finite numbers (NaN, Infinity)', () => {
        for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(validateChapterOverrideInput({ estHoursOverride: bad }).ok).toBe(false);
        }
    });

    it('rejects non-number values including null (null is not a clear-one-field signal)', () => {
        for (const bad of ['5', null, {}, [], true]) {
            const result = validateChapterOverrideInput({ timeAllocationOverride: bad });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toEqual({ field: 'timeAllocationOverride' });
            }
        }
    });

    it('reports the first invalid field in declaration order', () => {
        const result = validateChapterOverrideInput({
            weightageOverride: -1,
            estHoursOverride: -2,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'weightageOverride' });
        }
    });
});
