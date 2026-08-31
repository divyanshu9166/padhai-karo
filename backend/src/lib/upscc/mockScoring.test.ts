import { describe, expect, it } from 'vitest';
import { scoreMockQuestions } from './mockScoring';

describe('UPSC/SSC mock scoring', () => {
    it('applies fixed negative marking and leaves skipped questions neutral', () => {
        const result = scoreMockQuestions(
            [{ id: 'a', correctOption: 0 }, { id: 'b', correctOption: 1 }, { id: 'c', correctOption: 2 }],
            { a: 0, b: 3, c: null },
            2,
            { kind: 'FIXED_MARKS', marks: 0.5 },
        );
        expect(result).toMatchObject({ correctCount: 1, incorrectCount: 1, unansweredCount: 1, obtainedScore: 1.5, negativeMarks: 0.5, maximumScore: 6 });
    });

    it('applies fractional negative marking to the paper marks', () => {
        const result = scoreMockQuestions([{ id: 'a', correctOption: 0 }, { id: 'b', correctOption: 0 }], { a: 1, b: 0 }, 2, { kind: 'FRACTION_OF_QUESTION_MARKS', fraction: 1 / 3 });
        expect(result.obtainedScore).toBe(1.33);
    });
});
