/**
 * Property-based test for the pure PYQ / Timed-Paper scoring function.
 *
 *   - Property 31 (task 11.4): scoring correctness for PYQ and Timed Paper
 *     (Req 6.2, 6.3, 6.4, 19.5, 19.6).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the {@link scoreAttempt} logic it validates. The answer
 * key drives the scored set, so every key question is scored (timed-paper coverage); a
 * question may be answered correctly, answered incorrectly, explicitly left blank, or
 * omitted entirely (never reached) — all four cases are exercised.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { QuestionOutcome, scoreAttempt, type AnswerInput, type AnswerKeyEntry } from './score';

/** The four ways the generator can produce an answer for a key question. */
type AnswerMode = 'correct' | 'incorrect' | 'unanswered' | 'omitted';

/** The fixed option universe; four options so a distinct "wrong" choice always exists. */
const OPTIONS = ['0', '1', '2', '3'] as const;

describe('scoreAttempt properties', () => {
    // Feature: jee-neet-study-app, Property 31: For any set of answers and an answer key,
    // each question's outcome is CORRECT when the selected option matches the key,
    // UNANSWERED when no option was selected, and INCORRECT otherwise; the total score
    // equals the count of CORRECT outcomes; and unanswered questions are always labeled
    // unanswered and never counted as correct. Timed-paper scoring applies this to every
    // question of the paper.
    it('Property 31: scoring correctness (PYQ and Timed Paper) (Req 6.2, 6.3, 6.4, 19.5, 19.6)', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        correct: fc.constantFrom(...OPTIONS),
                        mode: fc.constantFrom<AnswerMode>(
                            'correct',
                            'incorrect',
                            'unanswered',
                            'omitted',
                        ),
                    }),
                    { maxLength: 40 },
                ),
                (specs) => {
                    // Assign unique question ids by index so the answer key is well-formed.
                    const answerKey: AnswerKeyEntry[] = specs.map((spec, i) => ({
                        questionId: `q${i}`,
                        correctOption: spec.correct,
                    }));

                    const answers: AnswerInput[] = [];
                    specs.forEach((spec, i) => {
                        const questionId = `q${i}`;
                        switch (spec.mode) {
                            case 'correct':
                                answers.push({ questionId, selectedOption: spec.correct });
                                break;
                            case 'incorrect': {
                                // A distinct wrong option always exists (4 options).
                                const wrong = OPTIONS.find((o) => o !== spec.correct) as string;
                                answers.push({ questionId, selectedOption: wrong });
                                break;
                            }
                            case 'unanswered':
                                answers.push({ questionId, selectedOption: null });
                                break;
                            case 'omitted':
                                // Never reached -> absent from answers entirely.
                                break;
                        }
                    });

                    const result = scoreAttempt(answers, answerKey);

                    // Every key question is scored (timed-paper coverage / key drives the set).
                    expect(result.perQuestion).toHaveLength(answerKey.length);

                    let expectedCorrect = 0;
                    result.perQuestion.forEach((pq, i) => {
                        const spec = specs[i];
                        expect(pq.questionId).toBe(`q${i}`);
                        expect(pq.correctOption).toBe(spec.correct);

                        if (spec.mode === 'correct') {
                            expect(pq.outcome).toBe(QuestionOutcome.CORRECT);
                            expectedCorrect += 1;
                        } else if (spec.mode === 'incorrect') {
                            expect(pq.outcome).toBe(QuestionOutcome.INCORRECT);
                        } else {
                            // unanswered AND omitted both score UNANSWERED with a null selection
                            // and never count toward the score.
                            expect(pq.outcome).toBe(QuestionOutcome.UNANSWERED);
                            expect(pq.selectedOption).toBeNull();
                        }
                    });

                    // totalScore equals the count of CORRECT outcomes.
                    expect(result.totalScore).toBe(expectedCorrect);
                    expect(result.totalScore).toBe(
                        result.perQuestion.filter((p) => p.outcome === QuestionOutcome.CORRECT)
                            .length,
                    );
                },
            ),
        );
    });
});
