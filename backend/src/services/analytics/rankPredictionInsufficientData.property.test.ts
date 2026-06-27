/**
 * Property-based test for the pure Rank_Prediction insufficient-data threshold
 * (task 6.3, design "Rank prediction" algorithm).
 *
 *   - Property 5 (task 6.3): rank prediction insufficient-data threshold (Req 3.4).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed beside the
 * {@link predictRank} logic it validates. It lives in a separate file from the Property 4
 * test (task 6.2) to avoid a filename collision.
 *
 * The property asserts the discriminator flips exactly at {@link MIN_SCORE_POINTS}: for any
 * number of available recent points, `predictRank` returns
 * `{ kind: 'INSUFFICIENT_DATA', minimumRequired: MIN_SCORE_POINTS }` iff the windowed point
 * count is below `MIN_SCORE_POINTS`, and an `OK` estimate otherwise. The windowed count is
 * `min(points.length, RECENT_POINTS_WINDOW)`; because `MIN_SCORE_POINTS <= RECENT_POINTS_WINDOW`,
 * the effective rule reduces to `points.length < MIN_SCORE_POINTS ⇒ INSUFFICIENT_DATA`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    getScoreStandingBands,
    type ScoreStandingBand,
} from '../../lib/analytics/cutoffCatalog';
import {
    MIN_SCORE_POINTS,
    RECENT_POINTS_WINDOW,
    predictRank,
    type RankPredictionScorePoint,
} from './rankPrediction';

// Run the full validation count regardless of the lighter global default (vitest.setup.ts).
const NUM_RUNS = Math.max(
    100,
    Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10) || 0,
);

const DATE_MIN = new Date('2024-01-01T00:00:00.000Z');
const DATE_MAX = new Date('2027-12-31T23:59:59.999Z');

// A valid, non-empty band set: the two seeded, contiguous-and-exhaustive catalog band
// sets (JEE percentile bands and NEET marks bands). Either is a valid input for predictRank.
const JEE_BANDS: ScoreStandingBand[] = getScoreStandingBands('JEE', 2024);
const NEET_BANDS: ScoreStandingBand[] = getScoreStandingBands('NEET', 2024);

const arbBands: fc.Arbitrary<ScoreStandingBand[]> = fc.constantFrom(JEE_BANDS, NEET_BANDS);

// An arbitrary normalized score point: a date in range and a normalizedPercent in [0, 100].
const arbPoint: fc.Arbitrary<RankPredictionScorePoint> = fc.record({
    date: fc.date({ min: DATE_MIN, max: DATE_MAX }),
    normalizedPercent: fc.double({ min: 0, max: 100, noNaN: true }),
});

// Point arrays of varying sizes 0 .. ~10, spanning below, at, and above MIN_SCORE_POINTS
// and RECENT_POINTS_WINDOW so the threshold boundary is exercised from both sides.
const arbPoints: fc.Arbitrary<RankPredictionScorePoint[]> = fc.array(arbPoint, {
    minLength: 0,
    maxLength: 10,
});

const arbReferenceYear: fc.Arbitrary<number> = fc.integer({ min: 2015, max: 2030 });

describe('predictRank insufficient-data threshold properties', () => {
    // Feature: performance-analytics, Property 5: For any number of available recent points,
    // predictRank returns { kind: 'INSUFFICIENT_DATA', minimumRequired: MIN_SCORE_POINTS } iff
    // the windowed point count (min(points.length, RECENT_POINTS_WINDOW)) is below
    // MIN_SCORE_POINTS, and an OK estimate otherwise. Since MIN_SCORE_POINTS <=
    // RECENT_POINTS_WINDOW, the effective rule is points.length < MIN_SCORE_POINTS =>
    // INSUFFICIENT_DATA.
    it('Property 5: rank prediction insufficient-data threshold (Req 3.4)', () => {
        // Guard the assumption the effective-rule reduction relies on.
        expect(MIN_SCORE_POINTS).toBeLessThanOrEqual(RECENT_POINTS_WINDOW);

        fc.assert(
            fc.property(arbPoints, arbBands, arbReferenceYear, (points, bands, referenceDataYear) => {
                const result = predictRank(points, bands, referenceDataYear);

                const windowedCount = Math.min(points.length, RECENT_POINTS_WINDOW);
                const expectInsufficient = windowedCount < MIN_SCORE_POINTS;

                if (expectInsufficient) {
                    // Below threshold => INSUFFICIENT_DATA carrying minimumRequired (Req 3.4).
                    expect(result.kind).toBe('INSUFFICIENT_DATA');
                    if (result.kind === 'INSUFFICIENT_DATA') {
                        expect(result.minimumRequired).toBe(MIN_SCORE_POINTS);
                    }
                } else {
                    // At/above threshold => an OK estimate band echoing the reference year.
                    expect(result.kind).toBe('OK');
                    if (result.kind === 'OK') {
                        expect(result.referenceDataYear).toBe(referenceDataYear);
                        expect(result.estimate.low).toBeLessThanOrEqual(result.estimate.high);
                    }
                }

                // The discriminator flips exactly at MIN_SCORE_POINTS, equivalently at the
                // raw count threshold given the window reduction.
                expect(result.kind === 'INSUFFICIENT_DATA').toBe(
                    points.length < MIN_SCORE_POINTS,
                );
            }),
            { numRuns: NUM_RUNS },
        );
    });
});
