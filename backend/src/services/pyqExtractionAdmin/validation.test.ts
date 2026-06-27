import { describe, expect, it } from 'vitest';

import { assembleJobData, validateCreateJobInput } from './validation';

/**
 * Unit tests for the pure create-job validation + job-data assembly (task 12.2, Req 7.1/7.3).
 * These run with no Redis/BullMQ or database — they exercise only the decision logic that
 * shapes the request body and maps it onto the worker job payload.
 */

const VALID_INPUT = {
    sourceImageRefs: ['s3://papers/p1/page-1.png', 's3://papers/p1/page-2.png'],
    track: 'NEET',
    year: 2023,
    subjectId: 'subject-biology',
    answerKeyId: 'answer-key-1',
    paperId: 'paper-1',
};

describe('validateCreateJobInput', () => {
    it('accepts a well-formed request and trims string fields', () => {
        const result = validateCreateJobInput({
            ...VALID_INPUT,
            sourceImageRefs: ['  ref-a  '],
            subjectId: '  subject-biology  ',
            answerKeyId: '  answer-key-1  ',
            paperId: '  paper-1  ',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({
                sourceImageRefs: ['ref-a'],
                track: 'NEET',
                year: 2023,
                subjectId: 'subject-biology',
                answerKeyId: 'answer-key-1',
                paperId: 'paper-1',
            });
        }
    });

    it('accepts a request without paperId, normalizing it to null', () => {
        const { paperId: _omit, ...rest } = VALID_INPUT;
        void _omit;
        const result = validateCreateJobInput(rest);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.paperId).toBeNull();
        }
    });

    it('accepts the JEE track', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, track: 'JEE' });
        expect(result.ok).toBe(true);
    });

    it('rejects a non-array sourceImageRefs', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, sourceImageRefs: 'not-array' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'sourceImageRefs' });
        }
    });

    it('rejects an empty sourceImageRefs array', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, sourceImageRefs: [] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'sourceImageRefs' });
        }
    });

    it('rejects a blank entry within sourceImageRefs', () => {
        const result = validateCreateJobInput({
            ...VALID_INPUT,
            sourceImageRefs: ['ok', '   '],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'sourceImageRefs[1]' });
        }
    });

    it('rejects an invalid track', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, track: 'SAT' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'track' });
        }
    });

    it('rejects a non-integer year', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, year: 2023.5 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'year' });
        }
    });

    it('rejects a non-number year', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, year: '2023' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'year' });
        }
    });

    it('rejects a blank subjectId', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, subjectId: '   ' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'subjectId' });
        }
    });

    it('rejects a blank answerKeyId', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, answerKeyId: '' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'answerKeyId' });
        }
    });

    it('rejects a non-string paperId when present', () => {
        const result = validateCreateJobInput({ ...VALID_INPUT, paperId: 42 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'paperId' });
        }
    });
});

describe('assembleJobData', () => {
    it('maps the validated request onto the worker payload, renaming track to examTrack', () => {
        const result = validateCreateJobInput(VALID_INPUT);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(assembleJobData(result.value)).toEqual({
                sourceImageRefs: VALID_INPUT.sourceImageRefs,
                examTrack: 'NEET',
                year: 2023,
                subjectId: 'subject-biology',
                answerKeyId: 'answer-key-1',
                paperId: 'paper-1',
            });
        }
    });
});
