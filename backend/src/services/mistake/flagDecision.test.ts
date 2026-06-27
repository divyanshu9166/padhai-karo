import { describe, expect, it } from 'vitest';

/**
 * Example (DB-independent) tests for the pure flaggable-decision logic (task 14.1, Req 18.3).
 *
 * Covers the decision the task specifies: a correctly-answered, unflagged question is
 * rejected; incorrect/unanswered questions are allowed; an explicit flag allows flagging even
 * a correct answer; a question absent from the attempt is rejected. Also covers the defensive
 * perQuestion JSON parsing and submitted-answer resolution. The numbered property test
 * (Property 35) is task 14.2.
 *
 * Validates: Requirements 18.3
 */

import {
    decideFlaggable,
    findPerQuestion,
    readPerQuestion,
    resolveSubmittedAnswer,
} from './flagDecision';

describe('readPerQuestion', () => {
    it('parses valid records and ignores malformed elements', () => {
        const records = readPerQuestion([
            { questionId: 'q1', outcome: 'CORRECT', selectedOption: '0' },
            { questionId: 'q2', outcome: 'INCORRECT', selectedOption: '3' },
            { questionId: 'q3', outcome: 'UNANSWERED', selectedOption: null },
            { questionId: 'q4', outcome: 'BOGUS' }, // unknown outcome -> skipped
            { outcome: 'CORRECT' }, // no questionId -> skipped
            42, // not an object -> skipped
            null,
        ]);
        expect(records).toEqual([
            { questionId: 'q1', outcome: 'CORRECT', selectedOption: '0' },
            { questionId: 'q2', outcome: 'INCORRECT', selectedOption: '3' },
            { questionId: 'q3', outcome: 'UNANSWERED', selectedOption: null },
        ]);
    });

    it('returns [] for non-array JSON', () => {
        expect(readPerQuestion(null)).toEqual([]);
        expect(readPerQuestion(undefined)).toEqual([]);
        expect(readPerQuestion({ questionId: 'q1' })).toEqual([]);
    });
});

describe('findPerQuestion', () => {
    const records = readPerQuestion([
        { questionId: 'q1', outcome: 'CORRECT' },
        { questionId: 'q2', outcome: 'INCORRECT' },
    ]);

    it('finds a question by id', () => {
        expect(findPerQuestion(records, 'q2')?.outcome).toBe('INCORRECT');
    });

    it('returns null when the question is absent', () => {
        expect(findPerQuestion(records, 'ghost')).toBeNull();
    });
});

describe('decideFlaggable', () => {
    it('rejects a correctly-answered, unflagged question (Req 18.3)', () => {
        const decision = decideFlaggable({ questionId: 'q1', outcome: 'CORRECT' }, false);
        expect(decision).toEqual({ allowed: false, reason: 'CORRECT_NOT_FLAGGED' });
    });

    it('allows an incorrectly-answered question', () => {
        const decision = decideFlaggable({ questionId: 'q1', outcome: 'INCORRECT' }, false);
        expect(decision).toEqual({ allowed: true, outcome: 'INCORRECT' });
    });

    it('allows an unanswered question', () => {
        const decision = decideFlaggable({ questionId: 'q1', outcome: 'UNANSWERED' }, false);
        expect(decision).toEqual({ allowed: true, outcome: 'UNANSWERED' });
    });

    it('allows a correctly-answered question when explicitly flagged (Req 18.3)', () => {
        const decision = decideFlaggable({ questionId: 'q1', outcome: 'CORRECT' }, true);
        expect(decision).toEqual({ allowed: true, outcome: 'CORRECT' });
    });

    it('rejects a question that is not part of the attempt', () => {
        expect(decideFlaggable(null, false)).toEqual({
            allowed: false,
            reason: 'NOT_IN_ATTEMPT',
        });
    });

    it('still rejects a missing question even when explicitly flagged', () => {
        expect(decideFlaggable(null, true)).toEqual({
            allowed: false,
            reason: 'NOT_IN_ATTEMPT',
        });
    });
});

describe('resolveSubmittedAnswer', () => {
    it('parses a stringified option index to an integer', () => {
        expect(resolveSubmittedAnswer({ questionId: 'q1', outcome: 'INCORRECT', selectedOption: '3' })).toBe(3);
    });

    it('returns null for an unanswered question', () => {
        expect(
            resolveSubmittedAnswer({ questionId: 'q1', outcome: 'UNANSWERED', selectedOption: null }),
        ).toBeNull();
    });

    it('returns null when no selectedOption was recorded', () => {
        expect(resolveSubmittedAnswer({ questionId: 'q1', outcome: 'INCORRECT' })).toBeNull();
    });

    it('returns null for a non-integer selection', () => {
        expect(
            resolveSubmittedAnswer({
                questionId: 'q1',
                outcome: 'INCORRECT',
                selectedOption: 'abc',
            }),
        ).toBeNull();
    });
});
