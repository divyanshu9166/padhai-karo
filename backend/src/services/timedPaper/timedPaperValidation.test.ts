import { describe, expect, it } from 'vitest';

/**
 * Unit tests for the pure timed-paper attempt validation (task 13.1).
 *
 * These exercise the framework- and database-free body validation/normalization in
 * isolation: required fields, answer-entry shape, the non-negative integer `timeTakenSec`,
 * and optional clientId normalization.
 *
 * Validates: Requirements 19.5, 19.6, 19.7
 */
import { validateTimedAttemptInput } from './timedPaperValidation';

describe('validateTimedAttemptInput', () => {
    const validBody = {
        paperId: 'paper-1',
        answers: [
            { questionId: 'q1', selectedOption: 0 },
            { questionId: 'q2' }, // unanswered (option omitted)
        ],
        timeTakenSec: 3600,
        clientId: 'c-1',
    };

    it('accepts a well-formed body and normalizes it', () => {
        const result = validateTimedAttemptInput(validBody);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({
                paperId: 'paper-1',
                answers: [
                    { questionId: 'q1', selectedOption: 0 },
                    { questionId: 'q2', selectedOption: null },
                ],
                timeTakenSec: 3600,
                clientId: 'c-1',
            });
        }
    });

    it('trims paperId and rejects a blank one', () => {
        expect(validateTimedAttemptInput({ ...validBody, paperId: '   ' }).ok).toBe(false);
        const ok = validateTimedAttemptInput({ ...validBody, paperId: '  paper-2  ' });
        expect(ok.ok).toBe(true);
        if (ok.ok) {
            expect(ok.value.paperId).toBe('paper-2');
        }
    });

    it('rejects a missing paperId', () => {
        const { paperId: _omit, ...rest } = validBody;
        const result = validateTimedAttemptInput(rest);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'paperId' });
        }
    });

    it('rejects answers that are not an array', () => {
        const result = validateTimedAttemptInput({ ...validBody, answers: 'nope' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'answers' });
        }
    });

    it('accepts an empty answers array (all questions unreached)', () => {
        const result = validateTimedAttemptInput({ ...validBody, answers: [] });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.answers).toEqual([]);
        }
    });

    it('rejects a non-object answer entry', () => {
        const result = validateTimedAttemptInput({ ...validBody, answers: [42] });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'answers[0]' });
        }
    });

    it('rejects an answer with a blank questionId', () => {
        const result = validateTimedAttemptInput({
            ...validBody,
            answers: [{ questionId: '  ', selectedOption: 1 }],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'answers[0].questionId' });
        }
    });

    it('rejects a non-integer selectedOption', () => {
        const result = validateTimedAttemptInput({
            ...validBody,
            answers: [{ questionId: 'q1', selectedOption: 1.5 }],
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'answers[0].selectedOption' });
        }
    });

    it('normalizes a null selectedOption to unanswered (null)', () => {
        const result = validateTimedAttemptInput({
            ...validBody,
            answers: [{ questionId: 'q1', selectedOption: null }],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.answers[0]).toEqual({ questionId: 'q1', selectedOption: null });
        }
    });

    it('rejects a missing, negative, or non-integer timeTakenSec', () => {
        const { timeTakenSec: _omit, ...rest } = validBody;
        expect(validateTimedAttemptInput(rest).ok).toBe(false);
        expect(validateTimedAttemptInput({ ...validBody, timeTakenSec: -1 }).ok).toBe(false);
        expect(validateTimedAttemptInput({ ...validBody, timeTakenSec: 1.5 }).ok).toBe(false);
        expect(validateTimedAttemptInput({ ...validBody, timeTakenSec: '60' }).ok).toBe(false);
    });

    it('accepts timeTakenSec of zero (instant submit)', () => {
        const result = validateTimedAttemptInput({ ...validBody, timeTakenSec: 0 });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.timeTakenSec).toBe(0);
        }
    });

    it('normalizes an absent or blank clientId to null', () => {
        const { clientId: _omit, ...rest } = validBody;
        const noClient = validateTimedAttemptInput(rest);
        expect(noClient.ok).toBe(true);
        if (noClient.ok) {
            expect(noClient.value.clientId).toBeNull();
        }

        const blank = validateTimedAttemptInput({ ...validBody, clientId: '   ' });
        expect(blank.ok).toBe(true);
        if (blank.ok) {
            expect(blank.value.clientId).toBeNull();
        }
    });
});
