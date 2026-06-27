/**
 * Property-based test for the pure Rank_Prediction mapping logic
 * (task 6.2, design "Rank prediction").
 *
 *   - Property 4 (task 6.2): rank prediction maps recent points to a standing band
 *     (Req 3.1, 3.2, 3.3).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed next to the
 * {@link predictRank} logic it validates. Generators produce a contiguous, exhaustive set
 * of `ScoreStandingMap` bands over the 0–100 score% range (either a JEE PERCENTILE map or a
 * NEET MARKS map) and at least `MIN_SCORE_POINTS` dated, normalized score points. The
 * property independently recomputes the expected band from the windowed mean and asserts the
 * returned estimate matches exactly, that `low <= high`, that the unit equals the bands'
 * unit, and that the supplied `referenceDataYear` is echoed.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CutoffUnit, ScoreStandingBand } from '../../lib/analytics/cutoffCatalog';
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

const arbDate = fc.date({ min: DATE_MIN, max: DATE_MAX });

// A contiguous, exhaustive band set over the 0–100 score% range for a single unit
// (PERCENTILE for JEE, MARKS for NEET). Interior breakpoints partition [0, 100] into
// adjacent bands [0,b1], [b1,b2], ..., [bn,100]; each band gets an arbitrary estimate
// pair (the module orders low/high defensively, mirrored by the expectation below).
const arbBandSet: fc.Arbitrary<ScoreStandingBand[]> = fc
    .uniqueArray(fc.integer({ min: 1, max: 99 }), { maxLength: 6 })
    .chain((interior) => {
        const boundaries = [0, ...[...interior].sort((a, b) => a - b), 100];
        const bandCount = boundaries.length - 1;
        return fc
            .record({
                unit: fc.constantFrom<CutoffUnit>('PERCENTILE', 'MARKS'),
                estimates: fc.array(
                    fc.tuple(
                        fc.double({ min: 0, max: 1000, noNaN: true }),
                        fc.double({ min: 0, max: 1000, noNaN: true }),
                    ),
                    { minLength: bandCount, maxLength: bandCount },
                ),
            })
            .map(({ unit, estimates }) => {
                const bands: ScoreStandingBand[] = [];
                for (let i = 0; i < bandCount; i += 1) {
                    const [a, b] = estimates[i];
                    bands.push({
                        minScorePercent: boundaries[i],
                        maxScorePercent: boundaries[i + 1],
                        estimateLow: a,
                        estimateHigh: b,
                        unit,
                    });
                }
                return bands;
            });
    });

// At least MIN_SCORE_POINTS dated points so the result is always OK (the insufficient-data
// branch is covered by Property 5). normalizedPercent is constrained to [0, 100].
const arbPoints: fc.Arbitrary<RankPredictionScorePoint[]> = fc.array(
    fc.record({
        date: arbDate,
        normalizedPercent: fc.double({ min: 0, max: 100, noNaN: true }),
    }),
    { minLength: MIN_SCORE_POINTS, maxLength: 20 },
);

const arbYear = fc.integer({ min: 2000, max: 2100 });

// Independently replicate the module's window + mean + band-selection so the expectation is
// derived without reusing predictRank's internals.
function expectedBand(
    points: readonly RankPredictionScorePoint[],
    bands: readonly ScoreStandingBand[],
): ScoreStandingBand {
    const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
    const window = sorted.slice(Math.max(0, sorted.length - RECENT_POINTS_WINDOW));
    const mean =
        window.reduce((sum, p) => sum + p.normalizedPercent, 0) / window.length;

    const sortedBands = [...bands].sort((a, b) => a.minScorePercent - b.minScorePercent);
    const lowest = sortedBands[0];
    const highest = sortedBands[sortedBands.length - 1];
    if (mean < lowest.minScorePercent) {
        return lowest;
    }
    if (mean > highest.maxScorePercent) {
        return highest;
    }
    return (
        sortedBands.find(
            (band) => mean >= band.minScorePercent && mean <= band.maxScorePercent,
        ) ?? highest
    );
}

describe('rank prediction properties', () => {
    // Feature: performance-analytics, Property 4: For any track/unit and contiguous-exhaustive
    // band set with at least MIN_SCORE_POINTS recent points, predictRank returns { kind: 'OK' }
    // with low <= high, the unit equal to the bands' unit (PERCENTILE for JEE, MARKS for NEET),
    // and the estimate of the band whose [min, max] contains the representative recent score
    // (mean of the most-recent window), clamped to the nearest band when out of range.
    // Validates: Requirements 3.1, 3.2, 3.3
    it('Property 4: rank prediction maps recent points to a standing band (Req 3.1, 3.2, 3.3)', () => {
        fc.assert(
            fc.property(arbPoints, arbBandSet, arbYear, (points, bands, year) => {
                const result = predictRank(points, bands, year);

                // ── With >= MIN_SCORE_POINTS points, a band is always produced (Req 3.1, 3.2) ──
                expect(result.kind).toBe('OK');
                if (result.kind !== 'OK') {
                    return;
                }

                const band = expectedBand(points, bands);
                const expectedLow = Math.min(band.estimateLow, band.estimateHigh);
                const expectedHigh = Math.max(band.estimateLow, band.estimateHigh);

                // ── Estimate matches the containing band (Req 3.1, 3.2) ──────────────────
                expect(result.estimate.low).toBe(expectedLow);
                expect(result.estimate.high).toBe(expectedHigh);

                // ── Always a band, never a single value: low <= high (Req 3.3) ───────────
                expect(result.estimate.low).toBeLessThanOrEqual(result.estimate.high);

                // ── Unit follows the bands' unit (PERCENTILE for JEE, MARKS for NEET) ─────
                expect(result.estimate.unit).toBe(band.unit);
                expect(result.estimate.unit).toBe(bands[0].unit);

                // ── The reference-data year is echoed (Req 3.5 surface) ──────────────────
                expect(result.referenceDataYear).toBe(year);
            }),
            { numRuns: NUM_RUNS },
        );
    });
});
