/**
 * Property-based test for the pure Score_Improvement_Gap computation
 * (task 7.2, design "Score-improvement gap (Req 4)" + Property 7).
 *
 *   - Property 7 (task 7.2): score-improvement gap and met-margin (Req 4.2, 4.3).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed beside the
 * {@link computeScoreGap} logic it validates.
 *
 * Property 7 (design): For any rank prediction and selected target cutoff, when the user's
 * standing meets or exceeds the cutoff the result is `MET` with `margin` equal to the
 * absolute amount the cutoff is exceeded by, otherwise the result is `GAP` with `gap` equal
 * to the absolute difference between the user's standing and the cutoff, with the comparison
 * and magnitude expressed in the cutoff's units (lower-is-better for RANK, higher-is-better
 * for PERCENTILE/MARKS). `INSUFFICIENT_DATA` predictions propagate unchanged.
 *
 * The test generates `OK` rank predictions with an arbitrary `{ low <= high, unit }` estimate
 * band and `INSUFFICIENT_DATA` predictions, paired with a target `{ closingValue, unit }`
 * across all three cutoff units, then independently computes the expected standing (the
 * documented best-comparable bound: `estimate.low` for the lower-is-better RANK unit,
 * `estimate.high` for the higher-is-better PERCENTILE/MARKS units), the expected kind, and the
 * expected magnitude, and asserts `computeScoreGap` agrees.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CutoffUnit } from '../../lib/analytics/cutoffCatalog';
import type { RankPredictionResult } from './rankPrediction';
import { computeScoreGap, type TargetCutoff } from './scoreGap';

// Run the full validation count regardless of the lighter global default (vitest.setup.ts).
const NUM_RUNS = Math.max(
    100,
    Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10) || 0,
);

const ALL_UNITS: readonly CutoffUnit[] = ['RANK', 'PERCENTILE', 'MARKS'] as const;

/** The documented best-comparable bound: RANK (lower-is-better) -> low; otherwise -> high. */
function bestComparableBound(unit: CutoffUnit, estimate: { low: number; high: number }): number {
    return unit === 'RANK' ? estimate.low : estimate.high;
}

// A finite, magnitude-bounded numeric value usable as a band bound, closing value, or year.
const arbValue: fc.Arbitrary<number> = fc.double({
    min: -100_000,
    max: 1_000_000,
    noNaN: true,
    noDefaultInfinity: true,
});

// An OK estimate band with low <= high (the invariant predictRank guarantees, Req 3.3).
const arbEstimateBand: fc.Arbitrary<{ low: number; high: number }> = fc
    .tuple(arbValue, arbValue)
    .map(([a, b]) => ({ low: Math.min(a, b), high: Math.max(a, b) }));

const arbUnit: fc.Arbitrary<CutoffUnit> = fc.constantFrom(...ALL_UNITS);

// An OK rank prediction: a band with a (possibly unrelated) unit + a reference year. The
// gap comparison's direction is driven by the *target* unit, not the prediction's unit, so
// the prediction unit is generated independently to exercise that.
const arbOkPrediction: fc.Arbitrary<RankPredictionResult> = fc
    .tuple(arbEstimateBand, arbUnit)
    .map(([band, unit]) => ({
        kind: 'OK' as const,
        estimate: { low: band.low, high: band.high, unit },
        referenceDataYear: 0, // overwritten per-run below; placeholder for the mapped shape
    }));

const arbInsufficientPrediction: fc.Arbitrary<RankPredictionResult> = fc
    .integer({ min: 1, max: 10 })
    .map((minimumRequired) => ({
        kind: 'INSUFFICIENT_DATA' as const,
        minimumRequired,
    }));

const arbPrediction: fc.Arbitrary<RankPredictionResult> = fc.oneof(
    arbOkPrediction,
    arbInsufficientPrediction,
);

const arbTarget: fc.Arbitrary<TargetCutoff> = fc.record({
    closingValue: arbValue,
    unit: arbUnit,
});

const arbReferenceYear: fc.Arbitrary<number> = fc.integer({ min: 2015, max: 2030 });

describe('computeScoreGap score-improvement gap properties', () => {
    // Feature: performance-analytics, Property 7: For any rank prediction and selected target
    // cutoff, INSUFFICIENT_DATA propagates unchanged; otherwise when the user's standing (the
    // documented best-comparable bound: estimate.low for lower-is-better RANK, estimate.high
    // for higher-is-better PERCENTILE/MARKS) meets/exceeds the cutoff the result is MET with
    // margin == |standing - closingValue|, else GAP with gap == |closingValue - standing|,
    // the comparison and magnitude expressed in the cutoff's units, echoing referenceDataYear.
    it('Property 7: score-improvement gap and met-margin (Req 4.2, 4.3)', () => {
        fc.assert(
            fc.property(
                arbPrediction,
                arbTarget,
                arbReferenceYear,
                (predictionTemplate, target, referenceDataYear) => {
                    // Stamp the run's reference year onto an OK prediction (placeholder above).
                    const prediction: RankPredictionResult =
                        predictionTemplate.kind === 'OK'
                            ? { ...predictionTemplate, referenceDataYear }
                            : predictionTemplate;

                    const result = computeScoreGap(prediction, target, referenceDataYear);

                    // (1) INSUFFICIENT_DATA propagates unchanged, carrying minimumRequired.
                    if (prediction.kind === 'INSUFFICIENT_DATA') {
                        expect(result.kind).toBe('INSUFFICIENT_DATA');
                        if (result.kind === 'INSUFFICIENT_DATA') {
                            expect(result.minimumRequired).toBe(prediction.minimumRequired);
                        }
                        return;
                    }

                    // (2) OK prediction: compute expected standing/kind/magnitude independently.
                    const lowerBetter = target.unit === 'RANK';
                    const standing = bestComparableBound(target.unit, prediction.estimate);
                    const expectMet = lowerBetter
                        ? standing <= target.closingValue
                        : standing >= target.closingValue;

                    // Magnitudes are in the cutoff's units; the unit is echoed on the result.
                    if (expectMet) {
                        expect(result.kind).toBe('MET');
                        if (result.kind === 'MET') {
                            expect(result.margin).toBe(Math.abs(standing - target.closingValue));
                            expect(result.unit).toBe(target.unit);
                            expect(result.referenceDataYear).toBe(referenceDataYear);
                        }
                    } else {
                        expect(result.kind).toBe('GAP');
                        if (result.kind === 'GAP') {
                            expect(result.gap).toBe(Math.abs(target.closingValue - standing));
                            expect(result.unit).toBe(target.unit);
                            expect(result.referenceDataYear).toBe(referenceDataYear);
                        }
                    }

                    // The magnitude is always non-negative regardless of branch.
                    if (result.kind === 'MET') {
                        expect(result.margin).toBeGreaterThanOrEqual(0);
                    } else if (result.kind === 'GAP') {
                        expect(result.gap).toBeGreaterThanOrEqual(0);
                    }
                },
            ),
            { numRuns: NUM_RUNS },
        );
    });
});
