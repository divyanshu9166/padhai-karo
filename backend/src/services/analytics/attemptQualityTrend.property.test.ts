/**
 * Property-based test for the pure attempt-quality-trend computation.
 *
 *   - Property 13 (task 10.2): attempt quality trend series, direction, subject filter, and
 *     insufficient-data (Req 10.1, 10.3, 10.4, 10.5).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed next to the
 * {@link computeAttemptQualityTrend} logic it validates. It mirrors the fast-check + vitest
 * convention of the other `*.property.test.ts` modules in this codebase
 * (see `attemptQuality.property.test.ts`).
 *
 * The expected series, directions, and insufficient-data outcome are derived independently of
 * the module under test: the per-attempt metrics, the optional subject filter (with dropping
 * of attempts that have no questions for the subject), the ascending-by-date ordering, the
 * insufficient-data threshold of two, and the earliest-vs-latest direction of change are all
 * recomputed here from the generated attempts and asserted against the module output.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { QuestionOutcome } from '../../lib/scoring/score';
import {
    computeAttemptQualityTrend,
    TrendDirection,
    type AttemptQualityTrendInput,
    type TrendQuestionOutcome,
} from './attemptQualityTrend';

const OUTCOME_POOL: readonly QuestionOutcome[] = [
    QuestionOutcome.CORRECT,
    QuestionOutcome.INCORRECT,
    QuestionOutcome.UNANSWERED,
];

/** A small subject universe so the subject filter both matches and drops across iterations. */
const SUBJECTS: readonly string[] = ['subj-A', 'subj-B', 'subj-C'];

/** An arbitrary per-question outcome carrying the PYQ's `subjectId` (Req 10.4). */
const outcomeArb: fc.Arbitrary<TrendQuestionOutcome> = fc.record({
    questionId: fc.uuid(),
    outcome: fc.constantFrom(...OUTCOME_POOL),
    subjectId: fc.constantFrom(...SUBJECTS),
});

/**
 * Optional total time taken: present non-negative seconds, explicitly `null`, or `undefined`
 * (a PYQ attempt records no time — Req 9.4).
 */
const timeTakenArb: fc.Arbitrary<number | null | undefined> = fc.oneof(
    fc.double({ min: 0, max: 100_000, noNaN: true }),
    fc.constant(null),
    fc.constant(undefined),
);

/**
 * An arbitrary in-range attempt. A deliberately narrow date range (in ms) makes equal-date
 * ties common so the stable ascending sort is exercised; `minLength: 0` admits empty attempts
 * which the subject filter drops.
 */
const attemptArb: fc.Arbitrary<AttemptQualityTrendInput> = fc.record({
    date: fc.integer({ min: 0, max: 5_000 }).map((ms) => new Date(ms)),
    perQuestion: fc.array(outcomeArb, { maxLength: 12 }),
    timeTakenSec: timeTakenArb,
});

const attemptsArb: fc.Arbitrary<AttemptQualityTrendInput[]> = fc.array(attemptArb, {
    maxLength: 8,
});

/**
 * Optional subject filter: no filter (`undefined`/`null`), one of the real subjects, or a
 * subject present on no question (forcing every attempt to be dropped).
 */
const subjectFilterArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.constantFrom(...SUBJECTS),
    fc.constant('subj-absent'),
);

/** Independently compute an attempt's quality metrics, replicating the documented formulas. */
function metricsOf(
    perQuestion: ReadonlyArray<TrendQuestionOutcome>,
    timeTakenSec: number | null | undefined,
): { accuracyPercent: number; averageTimePerQuestion: number | null; attemptRate: number } {
    const total = perQuestion.length;
    const unattempted = perQuestion.filter(
        (q) => q.outcome === QuestionOutcome.UNANSWERED,
    ).length;
    const correct = perQuestion.filter((q) => q.outcome === QuestionOutcome.CORRECT).length;
    const attempted = total - unattempted;

    return {
        accuracyPercent: attempted > 0 ? (correct / attempted) * 100 : 0,
        attemptRate: total > 0 ? (attempted / total) * 100 : 0,
        averageTimePerQuestion:
            timeTakenSec != null && total > 0 ? timeTakenSec / total : null,
    };
}

/** Sign-of-difference direction classifier (Req 10.3). */
function directionOf(earlier: number, later: number): TrendDirection {
    if (later > earlier) {
        return TrendDirection.INCREASED;
    }
    if (later < earlier) {
        return TrendDirection.DECREASED;
    }
    return TrendDirection.UNCHANGED;
}

describe('computeAttemptQualityTrend properties', () => {
    // Feature: performance-analytics, Property 13: For any set of in-range attempts, the trend
    // returns a date-ascending series of per-attempt quality metrics, reports the accuracy and
    // attempt-rate direction of change between the earliest and latest attempts matching
    // sign(latest - earliest), restricts to the selected subject's questions (dropping attempts
    // with none) when a subject filter is supplied, and returns INSUFFICIENT_DATA (minimum 2)
    // iff fewer than two attempts fall in range after filtering.
    it('Property 13: attempt quality trend series, direction, subject filter, and insufficient-data (Req 10.1, 10.3, 10.4, 10.5)', () => {
        fc.assert(
            fc.property(attemptsArb, subjectFilterArb, (attempts, subjectId) => {
                const result = computeAttemptQualityTrend(attempts, subjectId);

                // Independently build the expected, date-ascending series: apply the optional
                // subject filter, drop attempts with no questions for the subject (Req 10.4),
                // compute each attempt's metrics, then stable-sort by date (Req 10.1).
                const expectedPoints = attempts
                    .filter((attempt) => {
                        if (subjectId == null) {
                            return true;
                        }
                        return attempt.perQuestion.some((q) => q.subjectId === subjectId);
                    })
                    .map((attempt) => {
                        const perQuestion =
                            subjectId == null
                                ? attempt.perQuestion
                                : attempt.perQuestion.filter(
                                    (q) => q.subjectId === subjectId,
                                );
                        return {
                            date: attempt.date,
                            ...metricsOf(perQuestion, attempt.timeTakenSec),
                        };
                    });
                // Stable sort by ascending date (matches Array.prototype.sort stability).
                expectedPoints.sort((a, b) => a.date.getTime() - b.date.getTime());

                // INSUFFICIENT_DATA iff fewer than two in-range attempts after filtering
                // (Req 10.5).
                if (expectedPoints.length < 2) {
                    expect(result.kind).toBe('INSUFFICIENT_DATA');
                    if (result.kind === 'INSUFFICIENT_DATA') {
                        expect(result.minimumRequired).toBe(2);
                    }
                    return;
                }

                expect(result.kind).toBe('OK');
                if (result.kind !== 'OK') {
                    return;
                }

                // The series is the expected date-ascending per-attempt metrics (Req 10.1).
                expect(result.series).toHaveLength(expectedPoints.length);
                for (let i = 0; i < expectedPoints.length; i += 1) {
                    const actual = result.series[i];
                    const expected = expectedPoints[i];

                    expect(actual.date.getTime()).toBe(expected.date.getTime());
                    expect(actual.accuracyPercent).toBeCloseTo(expected.accuracyPercent, 10);
                    expect(actual.attemptRate).toBeCloseTo(expected.attemptRate, 10);
                    if (expected.averageTimePerQuestion === null) {
                        expect(actual.averageTimePerQuestion).toBeNull();
                    } else {
                        expect(actual.averageTimePerQuestion).toBeCloseTo(
                            expected.averageTimePerQuestion,
                            10,
                        );
                    }

                    // Dates are non-decreasing across the series (Req 10.1).
                    if (i > 0) {
                        expect(actual.date.getTime()).toBeGreaterThanOrEqual(
                            result.series[i - 1].date.getTime(),
                        );
                    }
                }

                // Directions match sign(latest - earliest) for accuracy and attempt rate
                // (Req 10.3).
                const earliest = expectedPoints[0];
                const latest = expectedPoints[expectedPoints.length - 1];
                expect(result.accuracyDirection).toBe(
                    directionOf(earliest.accuracyPercent, latest.accuracyPercent),
                );
                expect(result.attemptRateDirection).toBe(
                    directionOf(earliest.attemptRate, latest.attemptRate),
                );
            }),
            { numRuns: 100 },
        );
    });
});
