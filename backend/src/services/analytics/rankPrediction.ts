/**
 * Pure Rank_Prediction computation (task 6.1; design "Rank Prediction endpoint" + the
 * "Rank prediction" algorithm; Req 3.1, 3.2, 3.3, 3.4, 3.5).
 *
 * The Rank Prediction endpoint maps a User's recent normalized score points onto an
 * estimated standing band — a JEE Main percentile band (`JEE_Percentile_Estimate`) or a
 * NEET score range (`NEET_Score_Range_Estimate`) — using the active `ScoreStandingMap`
 * for the User's Exam_Track. This module performs that mapping as a framework- and
 * database-free pure function so it can be unit-tested in isolation and is the surface
 * exercised by the property tests (tasks 6.2/6.3, Properties 4 & 5).
 *
 * Following the Phase 1 layering convention (see `trajectory.ts`, `lib/scoring/score.ts`),
 * this module:
 *   - imports no Prisma client and no framework code,
 *   - accepts already-read plain rows (the thin service handler loads the trajectory points
 *     scoped to the requesting user and resolves the active bands + `referenceDataYear`,
 *     then passes them in),
 *   - never mutates its inputs,
 *   - is the property-test surface for rank-prediction behavior.
 *
 * ── Algorithm (design "Rank prediction") ──────────────────────────────────────────────────
 *   1. Take the most recent {@link RECENT_POINTS_WINDOW} points by date. If that windowed
 *      count is `< `{@link MIN_SCORE_POINTS}, return `INSUFFICIENT_DATA` carrying
 *      `minimumRequired = MIN_SCORE_POINTS` (Req 3.4).
 *   2. Compute the representative recent score % = the mean of the windowed points'
 *      `normalizedPercent`.
 *   3. Find the band whose inclusive `[minScorePercent, maxScorePercent]` contains the
 *      representative %, clamping to the nearest band when the value is out of range.
 *   4. Return `OK` with `estimate = { low, high, unit }` (`low <= high`, always a band and
 *      never a single value — Req 3.3) plus the `referenceDataYear` of the dataset used
 *      (Req 3.5). `unit` is `PERCENTILE` for JEE and `MARKS` for NEET, driven entirely by
 *      the supplied bands' `unit` (Req 3.1, 3.2).
 *
 * The Exam_Track and the active `ScoreStandingMap` (including its `referenceDataYear`) are
 * resolved by the service layer; this module stays pure/DB-free and simply consumes them.
 * The service returns `REFERENCE_DATA_UNAVAILABLE` when no bands exist, so this module is
 * only ever called with a non-empty band set.
 */
import type { ScoreStandingBand, CutoffUnit } from '../../lib/analytics/cutoffCatalog';

/**
 * Minimum number of recent Score_Data_Points required to compute a Rank_Prediction. With
 * fewer than this in the recent window, the prediction is `INSUFFICIENT_DATA` (Req 3.4).
 */
export const MIN_SCORE_POINTS = 3;

/**
 * Size of the trailing window of most-recent points (by date) used to compute the
 * representative recent score %. At most this many points contribute; `MIN_SCORE_POINTS`
 * of them must be present for a prediction to be produced.
 */
export const RECENT_POINTS_WINDOW = 5;

/**
 * The minimal score-point shape consumed by rank prediction: a dated, normalized value.
 * The Score_Trajectory's `ScoreDataPoint` (see `trajectory.ts`) satisfies this structurally,
 * so the full trajectory can be passed directly.
 */
export interface RankPredictionScorePoint {
    /** When the point occurred; used to select the most-recent window. */
    date: Date;
    /** The point's score as a percentage of its maximum (`0`–`100`). */
    normalizedPercent: number;
}

/** The estimated standing band returned by a successful Rank_Prediction (Req 3.3). */
export interface RankEstimateBand {
    /** Low end of the estimated standing band (in `unit`). `low <= high`. */
    low: number;
    /** High end of the estimated standing band (in `unit`). `high >= low`. */
    high: number;
    /** Standing unit: `PERCENTILE` for JEE, `MARKS` for NEET (driven by the bands). */
    unit: CutoffUnit;
}

/**
 * Discriminated Rank_Prediction result.
 *   - `OK` — a standing band estimate plus the reference-data year used (Req 3.1–3.3, 3.5).
 *   - `INSUFFICIENT_DATA` — fewer than `MIN_SCORE_POINTS` recent points (Req 3.4).
 */
export type RankPredictionResult =
    | {
        kind: 'OK';
        estimate: RankEstimateBand;
        referenceDataYear: number;
    }
    | {
        kind: 'INSUFFICIENT_DATA';
        minimumRequired: number;
    };

/**
 * Select the most-recent {@link RECENT_POINTS_WINDOW} points by date without mutating the
 * input array. Sorts a shallow copy ascending by date and returns the trailing slice.
 */
function mostRecentWindow(
    points: readonly RankPredictionScorePoint[],
): RankPredictionScorePoint[] {
    const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
    return sorted.slice(Math.max(0, sorted.length - RECENT_POINTS_WINDOW));
}

/** Arithmetic mean of the windowed points' `normalizedPercent`. */
function meanNormalizedPercent(points: readonly RankPredictionScorePoint[]): number {
    const total = points.reduce((sum, point) => sum + point.normalizedPercent, 0);
    return total / points.length;
}

/**
 * Find the band whose inclusive `[minScorePercent, maxScorePercent]` contains `scorePercent`,
 * clamping to the nearest band when the value falls outside every band's range. Bands are
 * authored contiguous and exhaustive over `0`–`100`, so an in-range value always matches;
 * the clamp handles any value below the lowest band or above the highest. The supplied band
 * set is required to be non-empty (the service guarantees this).
 */
function findContainingBand(
    bands: readonly ScoreStandingBand[],
    scorePercent: number,
): ScoreStandingBand {
    if (bands.length === 0) {
        throw new Error('rankPrediction: at least one ScoreStandingBand is required');
    }

    const sorted = [...bands].sort((a, b) => a.minScorePercent - b.minScorePercent);
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];

    // Clamp below the lowest band / above the highest band (out-of-range inputs).
    if (scorePercent < lowest.minScorePercent) {
        return lowest;
    }
    if (scorePercent > highest.maxScorePercent) {
        return highest;
    }

    // In range: the first band whose inclusive interval contains the value. Contiguous
    // bands share boundaries (e.g. 20 closes one band and opens the next); the lower band
    // wins the boundary, which is deterministic and within the requirement.
    const containing = sorted.find(
        (band) => scorePercent >= band.minScorePercent && scorePercent <= band.maxScorePercent,
    );
    return containing ?? highest;
}

/**
 * Compute a Rank_Prediction from the User's recent normalized score points and the active
 * `ScoreStandingMap` bands (design "Rank prediction"; Req 3.1–3.5).
 *
 * Pure: performs no I/O and mutates neither `points` nor `bands`.
 *
 * @param points            The User's normalized Score_Data_Points (the full trajectory may
 *                          be passed; the most-recent window is selected internally).
 * @param bands             The active `ScoreStandingMap` bands for the User's Exam_Track. The
 *                          bands' `unit` drives the result `unit` (`PERCENTILE` for JEE,
 *                          `MARKS` for NEET). Must be non-empty.
 * @param referenceDataYear The `Reference_Data_Year` of the bands, echoed on an `OK` result
 *                          (Req 3.5). Resolved by the service layer.
 * @returns `INSUFFICIENT_DATA` when fewer than {@link MIN_SCORE_POINTS} recent points exist
 *          (Req 3.4); otherwise `OK` with an estimate band (`low <= high`, Req 3.3) and the
 *          `referenceDataYear`.
 */
export function predictRank(
    points: readonly RankPredictionScorePoint[],
    bands: readonly ScoreStandingBand[],
    referenceDataYear: number,
): RankPredictionResult {
    const window = mostRecentWindow(points);

    if (window.length < MIN_SCORE_POINTS) {
        return { kind: 'INSUFFICIENT_DATA', minimumRequired: MIN_SCORE_POINTS };
    }

    const representativePercent = meanNormalizedPercent(window);
    const band = findContainingBand(bands, representativePercent);

    // Always present a band, never a single value (Req 3.3); normalize ordering defensively.
    const low = Math.min(band.estimateLow, band.estimateHigh);
    const high = Math.max(band.estimateLow, band.estimateHigh);

    return {
        kind: 'OK',
        estimate: { low, high, unit: band.unit },
        referenceDataYear,
    };
}
