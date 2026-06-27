import { describe, expect, it } from 'vitest';

/**
 * Example (DB-independent) tests for the pure Mistake Journal flag validation (task 14.1).
 *
 * Covers the request-shaping rules the task specifies: missing/invalid category rejection
 * (Req 18.2), source-type and required-field checks, note/explicitFlag normalization, and the
 * GET category-filter validation (Req 18.6). The numbered property test (Property 35) is
 * task 14.2 and is intentionally not implemented here.
 *
 * Validates: Requirements 18.1, 18.2
 */

import {
    isMistakeCategory,
    validateCategoryFilter,
    validateMistakeFlagInput,
} from './mistakeValidation';

const VALID = {
    sourceType: 'PYQ',
    attemptId: 'attempt-1',
    questionId: 'q-1',
    category: 'SILLY_MISTAKE',
};

describe('isMistakeCategory', () => {
    it('accepts each of the four valid categories', () => {
        for (const c of ['SILLY_MISTAKE', 'CONCEPT_GAP', 'TIME_PRESSURE', 'NEVER_SEEN_THIS']) {
            expect(isMistakeCategory(c)).toBe(true);
        }
    });

    it('rejects unknown / non-string values', () => {
        expect(isMistakeCategory('silly')).toBe(false);
        expect(isMistakeCategory('OTHER')).toBe(false);
        expect(isMistakeCategory(undefined)).toBe(false);
        expect(isMistakeCategory(null)).toBe(false);
        expect(isMistakeCategory(1)).toBe(false);
    });
});

describe('validateMistakeFlagInput', () => {
    it('accepts a well-formed request and normalizes optional fields', () => {
        const result = validateMistakeFlagInput({ ...VALID, note: '  careless  ' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({
                sourceType: 'PYQ',
                attemptId: 'attempt-1',
                questionId: 'q-1',
                category: 'SILLY_MISTAKE',
                note: 'careless',
                explicitFlag: false,
            });
        }
    });

    it('rejects a missing category (Req 18.2)', () => {
        const result = validateMistakeFlagInput({
            sourceType: 'PYQ',
            attemptId: 'attempt-1',
            questionId: 'q-1',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'category' });
        }
    });

    it('rejects an invalid category (Req 18.2)', () => {
        const result = validateMistakeFlagInput({ ...VALID, category: 'NOT_A_CATEGORY' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'category' });
        }
    });

    it('rejects an invalid sourceType', () => {
        const result = validateMistakeFlagInput({ ...VALID, sourceType: 'EXAM' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'sourceType' });
        }
    });

    it('rejects a missing/blank attemptId', () => {
        const result = validateMistakeFlagInput({ ...VALID, attemptId: '   ' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'attemptId' });
        }
    });

    it('rejects a missing/blank questionId', () => {
        const result = validateMistakeFlagInput({ ...VALID, questionId: '' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'questionId' });
        }
    });

    it('normalizes a blank note to null', () => {
        const result = validateMistakeFlagInput({ ...VALID, note: '   ' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.note).toBeNull();
        }
    });

    it('rejects a non-string note', () => {
        const result = validateMistakeFlagInput({ ...VALID, note: 42 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'note' });
        }
    });

    it('accepts an explicit flag boolean', () => {
        const result = validateMistakeFlagInput({ ...VALID, explicitFlag: true });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.explicitFlag).toBe(true);
        }
    });

    it('rejects a non-boolean explicitFlag', () => {
        const result = validateMistakeFlagInput({ ...VALID, explicitFlag: 'yes' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'explicitFlag' });
        }
    });
});

describe('validateCategoryFilter', () => {
    it('treats an absent filter as no filter', () => {
        expect(validateCategoryFilter(null)).toEqual({ ok: true, value: null });
        expect(validateCategoryFilter('')).toEqual({ ok: true, value: null });
    });

    it('accepts a valid category filter (Req 18.6)', () => {
        expect(validateCategoryFilter('CONCEPT_GAP')).toEqual({
            ok: true,
            value: 'CONCEPT_GAP',
        });
    });

    it('rejects an invalid category filter', () => {
        const result = validateCategoryFilter('bogus');
        expect(result.ok).toBe(false);
    });
});
