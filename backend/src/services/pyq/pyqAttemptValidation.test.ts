import { describe, expect, it } from 'vitest';

import { validatePyqAttemptInput } from './pyqAttemptValidation';

/**
 * Example (DB-independent) tests for the PYQ attempt body validation (task 11.3).
 *
 * Exercises the pure body-shaping logic: required fields, answer-entry validation, and
 * selected-option normalization. No database or framework involved.
 *
 * Validates: Requirements 6.2, 6.5
 */

describe('validatePyqAttemptInput', () => {
    it('accepts a well-formed attempt and normalizes fields', () => {
        const result = validatePyqAttemptInput({
            paperOrSetRef: '  jee-2024-set-1  ',
            answers: [
                { questionId: ' q1 ', selectedOption: 2 },
                { questionId: 'q2' }, // omitted option -> unanswered
                { questionId: 'q3', selectedOption: null }, // explicit null -> unanswered
            ],
            clientId: ' client-abc ',
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({
                paperOrSetRef: 'jee-2024-set-1',
                answers: [
                    { questionId: 'q1', selectedOption: 2 },
                    { questionId: 'q2', selectedOption: null },
                    { questionId: 'q3', selectedOption: null },
                ],
                clientId: 'client-abc',
            });
        }
    });

    it('accepts an empty answers array', () => {
        const result = validatePyqAttemptInput({ paperOrSetRef: 'ref', answers: [] });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.answers).toEqual([]);
            expect(result.value.clientId).toBeNull();
        }
    });

    it.each([undefined, null, '', '   ', 42])(
        'rejects a missing/blank paperOrSetRef %j',
        (paperOrSetRef) => {
            const result = validatePyqAttemptInput({
                paperOrSetRef,
                answers: [],
            } as unknown as Parameters<typeof validatePyqAttemptInput>[0]);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toEqual({ field: 'paperOrSetRef' });
            }
        },
    );

    it.each([undefined, null, 'nope', 42, {}])('rejects a non-array answers %j', (answers) => {
        const result = validatePyqAttemptInput({
            paperOrSetRef: 'ref',
            answers,
        } as unknown as Parameters<typeof validatePyqAttemptInput>[0]);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'answers' });
        }
    });

    it('rejects an answer entry that is not an object', () => {
        const result = validatePyqAttemptInput({
            paperOrSetRef: 'ref',
            answers: ['not-an-object'],
        } as unknown as Parameters<typeof validatePyqAttemptInput>[0]);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'answers[0]' });
        }
    });

    it.each([undefined, null, '', '   ', 7])(
        'rejects an answer with a missing/blank questionId %j',
        (questionId) => {
            const result = validatePyqAttemptInput({
                paperOrSetRef: 'ref',
                answers: [{ questionId, selectedOption: 1 }],
            } as unknown as Parameters<typeof validatePyqAttemptInput>[0]);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toEqual({ field: 'answers[0].questionId' });
            }
        },
    );

    it.each([1.5, 'a', '2', {}, true])(
        'rejects a non-integer selectedOption %j',
        (selectedOption) => {
            const result = validatePyqAttemptInput({
                paperOrSetRef: 'ref',
                answers: [{ questionId: 'q1', selectedOption }],
            } as unknown as Parameters<typeof validatePyqAttemptInput>[0]);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toEqual({ field: 'answers[0].selectedOption' });
            }
        },
    );

    it('normalizes a blank/absent clientId to null', () => {
        for (const clientId of [undefined, null, '', '   ', 5]) {
            const result = validatePyqAttemptInput({
                paperOrSetRef: 'ref',
                answers: [],
                clientId,
            } as unknown as Parameters<typeof validatePyqAttemptInput>[0]);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.clientId).toBeNull();
            }
        }
    });

    it('accepts selectedOption of 0 (a valid option index)', () => {
        const result = validatePyqAttemptInput({
            paperOrSetRef: 'ref',
            answers: [{ questionId: 'q1', selectedOption: 0 }],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.answers[0].selectedOption).toBe(0);
        }
    });
});
