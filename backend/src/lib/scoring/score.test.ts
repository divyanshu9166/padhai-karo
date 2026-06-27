import { describe, expect, it } from 'vitest';
import { QuestionOutcome, scoreAttempt, type AnswerKeyEntry } from './score';

const answerKey: AnswerKeyEntry[] = [
    { questionId: 'q1', correctOption: 'A' },
    { questionId: 'q2', correctOption: 'B' },
    { questionId: 'q3', correctOption: 'C' },
    { questionId: 'q4', correctOption: 'D' },
];

describe('scoreAttempt', () => {
    it('marks a matching selection CORRECT and counts it toward the score', () => {
        const result = scoreAttempt([{ questionId: 'q1', selectedOption: 'A' }], answerKey);

        const q1 = result.perQuestion.find((q) => q.questionId === 'q1');
        expect(q1?.outcome).toBe(QuestionOutcome.CORRECT);
        expect(result.totalScore).toBe(1);
    });

    it('marks a non-matching selection INCORRECT and does not count it', () => {
        const result = scoreAttempt([{ questionId: 'q1', selectedOption: 'B' }], answerKey);

        const q1 = result.perQuestion.find((q) => q.questionId === 'q1');
        expect(q1?.outcome).toBe(QuestionOutcome.INCORRECT);
        expect(result.totalScore).toBe(0);
    });

    it('marks an explicitly null selection UNANSWERED', () => {
        const result = scoreAttempt([{ questionId: 'q2', selectedOption: null }], answerKey);

        const q2 = result.perQuestion.find((q) => q.questionId === 'q2');
        expect(q2?.outcome).toBe(QuestionOutcome.UNANSWERED);
        expect(q2?.selectedOption).toBeNull();
    });

    it('marks an undefined/omitted selection UNANSWERED', () => {
        const result = scoreAttempt([{ questionId: 'q2' }], answerKey);

        const q2 = result.perQuestion.find((q) => q.questionId === 'q2');
        expect(q2?.outcome).toBe(QuestionOutcome.UNANSWERED);
    });

    it('scores unreached questions (absent from answers) as UNANSWERED — timed-paper rule', () => {
        // Only q1 was reached; q2/q3/q4 were never answered.
        const result = scoreAttempt([{ questionId: 'q1', selectedOption: 'A' }], answerKey);

        expect(result.perQuestion).toHaveLength(answerKey.length);
        const unreached = result.perQuestion.filter((q) => q.questionId !== 'q1');
        expect(unreached.every((q) => q.outcome === QuestionOutcome.UNANSWERED)).toBe(true);
        expect(unreached.every((q) => q.selectedOption === null)).toBe(true);
    });

    it('never counts unanswered questions toward the total score', () => {
        const result = scoreAttempt(
            [
                { questionId: 'q1', selectedOption: 'A' }, // correct
                { questionId: 'q2', selectedOption: null }, // unanswered
                // q3, q4 unreached -> unanswered
            ],
            answerKey,
        );

        expect(result.totalScore).toBe(1);
    });

    it('computes totalScore as the count of CORRECT outcomes across a full paper', () => {
        const result = scoreAttempt(
            [
                { questionId: 'q1', selectedOption: 'A' }, // correct
                { questionId: 'q2', selectedOption: 'B' }, // correct
                { questionId: 'q3', selectedOption: 'A' }, // incorrect
                { questionId: 'q4', selectedOption: null }, // unanswered
            ],
            answerKey,
        );

        expect(result.totalScore).toBe(2);
        expect(result.perQuestion.map((q) => q.outcome)).toEqual([
            QuestionOutcome.CORRECT,
            QuestionOutcome.CORRECT,
            QuestionOutcome.INCORRECT,
            QuestionOutcome.UNANSWERED,
        ]);
    });

    it('returns per-question results in answer-key order', () => {
        const result = scoreAttempt(
            [
                { questionId: 'q4', selectedOption: 'D' },
                { questionId: 'q1', selectedOption: 'A' },
            ],
            answerKey,
        );

        expect(result.perQuestion.map((q) => q.questionId)).toEqual(['q1', 'q2', 'q3', 'q4']);
    });

    it('ignores answers for questions not present in the answer key', () => {
        const result = scoreAttempt(
            [
                { questionId: 'q1', selectedOption: 'A' },
                { questionId: 'phantom', selectedOption: 'A' },
            ],
            answerKey,
        );

        expect(result.perQuestion.some((q) => q.questionId === 'phantom')).toBe(false);
        expect(result.totalScore).toBe(1);
    });

    it('uses the last occurrence when a question id is answered more than once', () => {
        const result = scoreAttempt(
            [
                { questionId: 'q1', selectedOption: 'B' }, // wrong
                { questionId: 'q1', selectedOption: 'A' }, // right (wins)
            ],
            answerKey,
        );

        const q1 = result.perQuestion.find((q) => q.questionId === 'q1');
        expect(q1?.selectedOption).toBe('A');
        expect(q1?.outcome).toBe(QuestionOutcome.CORRECT);
        expect(result.totalScore).toBe(1);
    });

    it('returns an empty result and zero score for an empty answer key', () => {
        const result = scoreAttempt([{ questionId: 'q1', selectedOption: 'A' }], []);

        expect(result.perQuestion).toEqual([]);
        expect(result.totalScore).toBe(0);
    });

    it('scores an entirely empty submission as all UNANSWERED with zero score', () => {
        const result = scoreAttempt([], answerKey);

        expect(result.perQuestion.every((q) => q.outcome === QuestionOutcome.UNANSWERED)).toBe(true);
        expect(result.totalScore).toBe(0);
    });
});
