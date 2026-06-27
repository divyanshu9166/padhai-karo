import { describe, expect, it } from 'vitest';

import type { PaperBundle } from '@/api';
import { scoreBundle } from './scoring';

/** Build a small downloadable bundle with an explicit answer key. */
function makeBundle(
    questions: Array<{ id: string; correctOption: number }>,
    keyEntries?: Record<string, number>,
): PaperBundle {
    return {
        paper: {
            id: 'paper-1',
            examTrack: 'JEE',
            year: 2024,
            session: null,
            durationMin: 60,
            questions: questions.map((q) => ({
                id: q.id,
                examTrack: 'JEE',
                year: 2024,
                subjectId: 'PHY',
                questionText: `Q ${q.id}`,
                options: ['a', 'b', 'c', 'd'],
                correctOption: q.correctOption,
                flaggedForReview: false,
            })),
        },
        answerKey: {
            id: 'key-1',
            paperId: 'paper-1',
            entries: keyEntries ?? Object.fromEntries(questions.map((q) => [q.id, q.correctOption])),
        },
    };
}

describe('scoreBundle', () => {
    it('labels CORRECT / INCORRECT / UNANSWERED and counts only correct (Req 6.2-6.4)', () => {
        const bundle = makeBundle([
            { id: 'q1', correctOption: 0 },
            { id: 'q2', correctOption: 1 },
            { id: 'q3', correctOption: 2 },
        ]);

        const result = scoreBundle(bundle, { q1: 0, q2: 3, q3: null });

        expect(result.totalScore).toBe(1);
        expect(result.perQuestion).toEqual([
            { questionId: 'q1', selectedOption: '0', correctOption: '0', outcome: 'CORRECT' },
            { questionId: 'q2', selectedOption: '3', correctOption: '1', outcome: 'INCORRECT' },
            { questionId: 'q3', selectedOption: null, correctOption: '2', outcome: 'UNANSWERED' },
        ]);
    });

    it('grades every question on the paper, treating absent answers as UNANSWERED', () => {
        const bundle = makeBundle([
            { id: 'q1', correctOption: 0 },
            { id: 'q2', correctOption: 1 },
        ]);

        const result = scoreBundle(bundle, {}); // no answers provided at all

        expect(result.totalScore).toBe(0);
        expect(result.perQuestion).toHaveLength(2);
        expect(result.perQuestion.every((p) => p.outcome === 'UNANSWERED')).toBe(true);
    });

    it('prefers the official answer key over the question-carried correctOption', () => {
        // The key says q1's correct option is 2, even though the question carries 0.
        const bundle = makeBundle([{ id: 'q1', correctOption: 0 }], { q1: 2 });

        expect(scoreBundle(bundle, { q1: 2 }).totalScore).toBe(1);
        expect(scoreBundle(bundle, { q1: 0 }).perQuestion[0].outcome).toBe('INCORRECT');
    });
});
