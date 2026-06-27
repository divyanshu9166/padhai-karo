/**
 * Pure Attempt-Quality-Trend computation (task 10.1; design "Attempt quality trend &
 * direction"; Req 10.1, 10.3, 10.4, 10.5).
 *
 * The Attempt Quality Trend surfaces how a user's exam *technique* changes over time —
 * Accuracy_Percentage, Average_Time_Per_Question, and Attempt_Rate across their attempts —
 * reported separately from the content-knowledge metrics of the Score_Trajectory (Req 10.1,
 * 10.2). This module performs that derivation as a framework- and database-free pure
 * function, mirroring the Phase 1 / Phase 2 pure-module convention (see
 * `attemptQuality.ts`, `trajectory.ts`, `lib/scoring/score.ts`): it imports no Prisma client
 * and no framework code, accepts already-read plain rows (the thin service handler loads
 * them, scoped to the requesting user, and passes them in), never mutates its inputs, and is
 * the surface exercised by the property test (task 10.2, Property 13).
 *
 * It builds on {@link computeAttemptQuality} from `attemptQuality.ts` to derive each
 * attempt's metrics, reusing that single source of truth rather than re-deriving accuracy /
 * attempt-rate here.
 *
 * ── Per-attempt point (Req 10.1) ──────────────────────────────────────────────────────────
 * Each in-range attempt becomes one {@link AttemptQualityPoint} carrying its date and the
 * quality metrics from {@link computeAttemptQuality}, and the series is sorted ascending by
 * date.
 *
 * ── Subject filter (Req 10.4) ─────────────────────────────────────────────────────────────
 * When a `subjectId` filter is supplied, each attempt is restricted to the per-question rows
 * whose `subjectId` equals the selected subject, and that attempt's metrics are recomputed
 * over only those questions. An attempt that then has zero questions for the subject is
 * dropped from the series entirely.
 *
 * ── Direction of change (Req 10.3) ────────────────────────────────────────────────────────
 * Accuracy and attempt-rate directions are computed by comparing the latest point to the
 * earliest point: `INCREASED` when later > earlier, `DECREASED` when later < earlier, else
 * `UNCHANGED`.
 *
 * ── Insufficient data (Req 10.5) ──────────────────────────────────────────────────────────
 * When fewer than two attempts fall in range (after the optional subject filter), no
 * direction of change can be reported, so the result is
 * `{ kind: 'INSUFFICIENT_DATA', minimumRequired: 2 }`.
 */

import {
    AttemptQuestionOutcome,
    AttemptQuality,
    computeAttemptQuality,
} from './attemptQuality';

/**
 * One question's persisted outcome within an attempt, carrying the `subjectId` of its PYQ so
 * the optional subject filter can restrict an attempt to a single subject's questions
 * (Req 10.4). Extends the base {@link AttemptQuestionOutcome} consumed by
 * {@link computeAttemptQuality}. Plain DB-free shape — the service resolves each question's
 * `PYQ.subjectId` and maps the persisted per-question rows onto this.
 */
export interface TrendQuestionOutcome extends AttemptQuestionOutcome {
    subjectId: string;
}

/**
 * One in-range attempt as needed for trend assembly: the date used to order the series
 * (Req 10.1) and place its endpoints (Req 10.3), its per-question outcomes carrying
 * `subjectId` (Req 10.4), and the optional total time taken used for
 * Average_Time_Per_Question (`null`/absent for a PYQ attempt that records no time —
 * Req 9.4). Plain DB-free shape mapped from a persisted PYQAttempt / TimedPaperAttempt.
 */
export interface AttemptQualityTrendInput {
    date: Date;
    perQuestion: ReadonlyArray<TrendQuestionOutcome>;
    timeTakenSec?: number | null;
}

/**
 * A single dated point in the Attempt_Quality_Trend: an attempt's date plus the quality
 * metrics derived by {@link computeAttemptQuality} (Req 10.1).
 */
export interface AttemptQualityPoint {
    date: Date;
    accuracyPercent: number;
    averageTimePerQuestion: number | null;
    attemptRate: number;
}

/** The direction of change of a metric between the earliest and latest points (Req 10.3). */
export const TrendDirection = {
    INCREASED: 'INCREASED',
    DECREASED: 'DECREASED',
    UNCHANGED: 'UNCHANGED',
} as const;

export type TrendDirection = (typeof TrendDirection)[keyof typeof TrendDirection];

/**
 * The Attempt_Quality_Trend result, a discriminated union mirroring the Phase 1 convention
 * of returning expected states in the response body rather than as errors:
 *   - `OK` — at least two in-range points: the date-ascending series plus the accuracy and
 *     attempt-rate directions of change (Req 10.1, 10.3).
 *   - `INSUFFICIENT_DATA` — fewer than two in-range attempts, so no direction can be
 *     reported; carries the minimum (2) required (Req 10.5).
 */
export type AttemptQualityTrendResult =
    | {
        kind: 'OK';
        series: AttemptQualityPoint[];
        accuracyDirection: TrendDirection;
        attemptRateDirection: TrendDirection;
    }
    | { kind: 'INSUFFICIENT_DATA'; minimumRequired: 2 };

/**
 * Classify the direction of change between an earlier and a later metric value (Req 10.3):
 * `INCREASED` when the later value exceeds the earlier, `DECREASED` when it is smaller, and
 * `UNCHANGED` when they are equal.
 */
function directionOf(earlier: number, later: number): TrendDirection {
    if (later > earlier) {
        return TrendDirection.INCREASED;
    }
    if (later < earlier) {
        return TrendDirection.DECREASED;
    }
    return TrendDirection.UNCHANGED;
}

/** Project an attempt's computed {@link AttemptQuality} onto a dated trend point. */
function toPoint(date: Date, quality: AttemptQuality): AttemptQualityPoint {
    return {
        date,
        accuracyPercent: quality.accuracyPercent,
        averageTimePerQuestion: quality.averageTimePerQuestion,
        attemptRate: quality.attemptRate,
    };
}

/**
 * Compute the user's Attempt_Quality_Trend over a set of in-range attempts (Req 10.1, 10.3,
 * 10.4, 10.5).
 *
 * Each attempt is mapped to a dated {@link AttemptQualityPoint} via
 * {@link computeAttemptQuality}; the series is sorted ascending by date. When `subjectId` is
 * supplied, each attempt is first restricted to the per-question rows whose `subjectId`
 * matches, its metrics are recomputed over only those questions, and an attempt with no
 * questions for the subject is dropped (Req 10.4). With fewer than two resulting points the
 * function returns `INSUFFICIENT_DATA` (`minimumRequired: 2`, Req 10.5); otherwise it reports
 * the accuracy and attempt-rate directions of change between the earliest and latest points
 * (Req 10.3).
 *
 * Pure: no I/O, builds and returns a new array, does not mutate any input row or array.
 *
 * @param attempts  The user's in-range attempts (the service applies any `[from, to]` filter
 *                  before calling this; this function does not re-filter by date).
 * @param subjectId Optional Subject filter; when supplied, restricts each attempt to that
 *                  subject's questions and drops attempts with none (Req 10.4).
 */
export function computeAttemptQualityTrend(
    attempts: readonly AttemptQualityTrendInput[],
    subjectId?: string | null,
): AttemptQualityTrendResult {
    const points: AttemptQualityPoint[] = [];

    for (const attempt of attempts) {
        const perQuestion =
            subjectId != null
                ? attempt.perQuestion.filter((q) => q.subjectId === subjectId)
                : attempt.perQuestion;

        // Drop an attempt that has no questions for the selected subject (Req 10.4).
        if (subjectId != null && perQuestion.length === 0) {
            continue;
        }

        const quality = computeAttemptQuality(perQuestion, attempt.timeTakenSec);
        points.push(toPoint(attempt.date, quality));
    }

    points.sort((a, b) => a.date.getTime() - b.date.getTime());

    // A direction of change needs at least two points to compare (Req 10.5).
    if (points.length < 2) {
        return { kind: 'INSUFFICIENT_DATA', minimumRequired: 2 };
    }

    const earliest = points[0];
    const latest = points[points.length - 1];

    return {
        kind: 'OK',
        series: points,
        accuracyDirection: directionOf(earliest.accuracyPercent, latest.accuracyPercent),
        attemptRateDirection: directionOf(earliest.attemptRate, latest.attemptRate),
    };
}
