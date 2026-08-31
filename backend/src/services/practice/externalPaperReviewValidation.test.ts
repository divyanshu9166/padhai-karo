import { describe, expect, it } from 'vitest';

import { validateExternalPaperReviewInput } from './externalPaperReviewValidation';

const valid = {
    title: 'UPSC GS Paper 1 practice',
    testDate: '2026-08-20T10:00:00.000Z',
    obtainedScore: 52,
    maxScore: 100,
    breakdown: [{ label: 'Polity', obtainedScore: 12, maxScore: 25 }],
    mistakeTags: ['CONCEPT_GAP', 'TIME_PRESSURE'],
};

describe('validateExternalPaperReviewInput', () => {
    it('normalizes a valid self-reported review without accepting future marks', () => {
        const result = validateExternalPaperReviewInput(valid);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.title).toBe('UPSC GS Paper 1 practice');
        expect(result.value.mistakeTags).toEqual(['CONCEPT_GAP', 'TIME_PRESSURE']);
    });

    it('rejects a score that exceeds its stated maximum', () => {
        const result = validateExternalPaperReviewInput({ ...valid, obtainedScore: 101 });
        expect(result).toMatchObject({ ok: false, message: expect.stringContaining('score') });
    });

    it('rejects unsupported tags rather than silently changing the review', () => {
        const result = validateExternalPaperReviewInput({ ...valid, mistakeTags: ['RANK_PREDICTION'] });
        expect(result).toMatchObject({ ok: false, message: expect.stringContaining('invalid') });
    });
});
