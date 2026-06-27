/**
 * Property-based test for the pure attempt-quality computation.
 *
 *   - Property 11 (task 9.2): attempt quality metrics (Req 9.1, 9.2, 9.3, 9.4).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed next
 * to the {@link computeAttemptQuality} logic it validates. It mirrors the
 * fast-check + vitest convention of the other `*.property.test.ts` modules in
 * this codebase.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { QuestionOutcome } from '../../lib/scoring/score';
import {
    computeAttemptQuality,
    type AttemptQuestionOutcome,
} from './attemptQuality';

const OUTCOME_POOL: readonly QuestionOutcome[] = [
    QuestionOutcome.CORRECT,
    QuestionOutcome.INCORRECT,
    QuestionOutcome.UNANSWERED,
];

/** An arbitrary per-question outcome entry. */
const outcomeArb: fc.Arbitrary<AttemptQuestionOutcome> = fc.record({
    questionId: fc.uuid(),
    outcome: fc.constantFrom(...OUTCOME_POOL),
});

/**
 * Arbitrary outcome arrays. `minLength: 0` admits the empty attempt; the
 * `constantFrom` outcome pool means all-UNANSWERED (and all-CORRECT etc.)
 * attempts arise naturally across iterations.
 */
const perQuestionArb: fc.Arbitrary<AttemptQuestionOutcome[]> = fc.array(outcomeArb, {
    maxLength: 50,
});

/**
 * Optional time taken: present non-negative seconds, or explicitly `null`, or
 * `undefined` (no time recorded — e.g. a PYQ attempt, Req 9.4).
 */
const timeTakenArb: fc.Arbitrary<number | null | undefined> = fc.oneof(
    fc.double({ min: 0, max: 100_000, noNaN: true }),
    fc.constant(null),
    fc.constant(undefined),
);

describe('computeAttemptQuality properties', () => {
    // Feature: performance-analytics, Property 11: For any attempt with persisted per-question
    // outcomes and an optional time taken, accuracy == correct/attempted*100 (0 when none
    // attempted), unattemptedCount == number of UNANSWERED, attemptRate == attempted/total*100,
    // and averageTimePerQuestion == timeTaken/total when time present else null.
    it('Property 11: attempt quality metrics (Req 9.1, 9.2, 9.3, 9.4)', () => {
        fc.assert(
            fc.property(
                perQuestionArb,
                timeTakenArb,
                (perQuestion, timeTakenSec) => {
                    const result = computeAttemptQuality(perQuestion, timeTakenSec);

                    const total = perQuestion.length;
                    const unattempted = perQuestion.filter(
                        (q) => q.outcome === QuestionOutcome.UNANSWERED,
                    ).length;
                    const correct = perQuestion.filter(
                        (q) => q.outcome === QuestionOutcome.CORRECT,
                    ).length;
                    const attempted = total - unattempted;

                    // unattemptedCount == number of UNANSWERED (Req 9.1).
                    expect(result.unattemptedCount).toBe(unattempted);

                    // accuracyPercent == correct/attempted*100, 0 when none attempted
                    // (Req 9.2, 9.3).
                    const expectedAccuracy =
                        attempted > 0 ? (correct / attempted) * 100 : 0;
                    expect(result.accuracyPercent).toBeCloseTo(expectedAccuracy, 10);
                    if (attempted === 0) {
                        expect(result.accuracyPercent).toBe(0);
                    }

                    // attemptRate == attempted/total*100, 0 when no questions (Req 9.1).
                    const expectedAttemptRate =
                        total > 0 ? (attempted / total) * 100 : 0;
                    expect(result.attemptRate).toBeCloseTo(expectedAttemptRate, 10);
                    if (total === 0) {
                        expect(result.attemptRate).toBe(0);
                    }

                    // averageTimePerQuestion == timeTaken/total when time present and there
                    // are questions, else null (Req 9.4).
                    if (timeTakenSec != null && total > 0) {
                        expect(result.averageTimePerQuestion).toBeCloseTo(
                            timeTakenSec / total,
                            10,
                        );
                    } else {
                        expect(result.averageTimePerQuestion).toBeNull();
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
