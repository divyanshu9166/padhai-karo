/**
 * Property-based test for the pre-normalization Combined_Weightage_Signal (task 4.2).
 *
 *   - Property 3 (task 4.2): Combined_Weightage_Signal is non-negative and monotonic
 *     (Req 3.1, 3.3, 3.4, 3.5).
 *
 * The pure `combinedWeightageSignal` fuses each Chapter's `pyqFrequency` and
 * `historicalFrequency` into `rawSignal = WPYQ*pyq + WHIST*hist` (the pre-normalization
 * combined value carried on each `ChapterSignal`). Because both `SIGNAL_WEIGHTS` are
 * strictly positive and both inputs are non-negative, `rawSignal` must be:
 *   - non-negative (Req 3.1);
 *   - monotonic non-decreasing in each input while the other is held constant (Req 3.1);
 *   - derived from a single input alone when only that input is positive (Req 3.3, 3.4);
 *   - exactly zero when both inputs are zero (Req 3.5).
 *
 * `rawSignal` depends only on a Chapter's own inputs (normalization, which depends on the
 * whole set, is Property 4's concern), so each property below drives a single-Chapter input
 * and reads back the one resulting `rawSignal`.
 *
 * fast-check assertions, each running a minimum of 100 iterations.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    SIGNAL_WEIGHTS,
    combinedWeightageSignal,
    type ChapterSignalInput,
} from './signal';

/** Non-negative, finite frequency value (Req 1/2 guarantee inputs are `>= 0`). */
const freq = (): fc.Arbitrary<number> =>
    fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

/** A non-negative, finite increment used to probe monotonicity. */
const delta = (): fc.Arbitrary<number> =>
    fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true });

/** Build a single-Chapter input and return its computed `rawSignal`. */
function rawSignalOf(pyqFrequency: number, historicalFrequency: number): number {
    const input: ChapterSignalInput = {
        chapterId: 'c1',
        referenceKey: 'k1',
        pyqFrequency,
        historicalFrequency,
        hasHistoricalData: historicalFrequency > 0,
    };
    const [signal] = combinedWeightageSignal([input]);
    return signal.rawSignal;
}

describe('Combined_Weightage_Signal non-negativity and monotonicity', () => {
    // Feature: weightage-based-time-allocation, Property 3: Combined_Weightage_Signal is
    // non-negative and monotonic.
    it('Property 3: rawSignal is non-negative for any non-negative inputs (Req 3.1)', () => {
        fc.assert(
            fc.property(freq(), freq(), (pyq, hist) => {
                expect(rawSignalOf(pyq, hist)).toBeGreaterThanOrEqual(0);
            }),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 3: Combined_Weightage_Signal is
    // non-negative and monotonic.
    it('Property 3: rawSignal does not decrease when pyqFrequency increases (Req 3.1)', () => {
        fc.assert(
            fc.property(freq(), freq(), delta(), (pyq, hist, d) => {
                const before = rawSignalOf(pyq, hist);
                const after = rawSignalOf(pyq + d, hist);
                expect(after).toBeGreaterThanOrEqual(before);
            }),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 3: Combined_Weightage_Signal is
    // non-negative and monotonic.
    it('Property 3: rawSignal does not decrease when historicalFrequency increases (Req 3.1)', () => {
        fc.assert(
            fc.property(freq(), freq(), delta(), (pyq, hist, d) => {
                const before = rawSignalOf(pyq, hist);
                const after = rawSignalOf(pyq, hist + d);
                expect(after).toBeGreaterThanOrEqual(before);
            }),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 3: Combined_Weightage_Signal is
    // non-negative and monotonic.
    it('Property 3: with only PYQ positive, rawSignal derives from PYQ alone (Req 3.4)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 1e-6, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
                (pyq) => {
                    const raw = rawSignalOf(pyq, 0);
                    // No historical contribution: signal is exactly WPYQ * pyq, and positive.
                    expect(raw).toBeCloseTo(SIGNAL_WEIGHTS.pyq * pyq, 9);
                    expect(raw).toBeGreaterThan(0);
                },
            ),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 3: Combined_Weightage_Signal is
    // non-negative and monotonic.
    it('Property 3: with only historical positive, rawSignal derives from historical alone (Req 3.3)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 1e-6, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
                (hist) => {
                    const raw = rawSignalOf(0, hist);
                    // No PYQ contribution: signal is exactly WHIST * hist, and positive.
                    expect(raw).toBeCloseTo(SIGNAL_WEIGHTS.historical * hist, 9);
                    expect(raw).toBeGreaterThan(0);
                },
            ),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 3: Combined_Weightage_Signal is
    // non-negative and monotonic.
    it('Property 3: with both inputs zero, rawSignal is exactly zero (Req 3.5)', () => {
        expect(rawSignalOf(0, 0)).toBe(0);
    });
});
