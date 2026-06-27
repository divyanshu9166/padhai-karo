/**
 * Property-based test that incorrect timed-paper questions are journal-eligible.
 *
 *   - Property 38 (task 13.2): incorrect timed-paper questions are journal-eligible
 *     (Req 19.8).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the {@link scoreTimedAttempt} logic it validates. Every
 * question scored INCORRECT in a timed-paper attempt must be representable as a mistake-
 * journal flag: it carries a non-empty `questionId` and an `outcome`, and the shared pure
 * flag decision ({@link decideFlaggable}) permits flagging it without an explicit flag.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { QuestionOutcome } from '@/lib/scoring';

import { decideFlaggable, type PerQuestionRecord } from '../mistake/flagDecision';
import { scoreTimedAttempt, type PaperAnswerSource } from './timedPaperAttemptService';
import type { NormalizedTimedAnswer } from './timedPaperValidation';

/** Answer modes the generator produces per paper question. */
type AnswerMode = 'correct' | 'incorrect' | 'unanswered' | 'omitted';

describe('scoreTimedAttempt journal-eligibility properties', () => {
    // Feature: jee-neet-study-app, Property 38: For any timed-paper attempt, every question
    // scored incorrect is eligible to be flagged into the mistake journal.
    it('Property 38: every INCORRECT timed-paper question is journal-eligible (Req 19.8)', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        correctOption: fc.integer({ min: 0, max: 3 }),
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
                    // Unique question ids by index -> a well-formed paper (the full scored set).
                    const questions: PaperAnswerSource[] = specs.map((spec, i) => ({
                        id: `q${i}`,
                        correctOption: spec.correctOption,
                    }));

                    const answers: NormalizedTimedAnswer[] = [];
                    specs.forEach((spec, i) => {
                        const questionId = `q${i}`;
                        switch (spec.mode) {
                            case 'correct':
                                answers.push({ questionId, selectedOption: spec.correctOption });
                                break;
                            case 'incorrect':
                                // A distinct wrong index in 0..4 always exists for 0..3 correct.
                                answers.push({
                                    questionId,
                                    selectedOption: (spec.correctOption + 1) % 5,
                                });
                                break;
                            case 'unanswered':
                                answers.push({ questionId, selectedOption: null });
                                break;
                            case 'omitted':
                                break; // never reached
                        }
                    });

                    const result = scoreTimedAttempt(answers, questions);

                    // Every question of the paper is scored (key drives the set).
                    expect(result.perQuestion).toHaveLength(questions.length);

                    for (const pq of result.perQuestion) {
                        if (pq.outcome === QuestionOutcome.INCORRECT) {
                            // Journal-eligible: identifiable question + flaggable decision.
                            expect(typeof pq.questionId).toBe('string');
                            expect(pq.questionId.length).toBeGreaterThan(0);

                            const record: PerQuestionRecord = {
                                questionId: pq.questionId,
                                outcome: pq.outcome,
                                selectedOption: pq.selectedOption,
                            };
                            const decision = decideFlaggable(record, false);
                            expect(decision.allowed).toBe(true);
                        }
                    }
                },
            ),
        );
    });
});
