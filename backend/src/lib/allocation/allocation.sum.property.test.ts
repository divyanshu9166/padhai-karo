/**
 * Property-based test for Suggested_Time_Allocation proportionality and the
 * shares-sum-to-one invariant (task 6.2; design "Correctness Properties →
 * Property 7").
 *
 *   - Property 7: Suggested allocation shares are proportional and sum to one
 *     Validates: Requirements 5.1, 5.3, 6.1
 *
 * Property 7 (design statement): For any set of pending Chapters with at least
 * one positive `Combined_Weightage_Signal` and no User overrides, each Chapter's
 * `Allocation_Share` equals its `Combined_Weightage_Signal` divided by the sum of
 * the included Chapters' signals, a strictly higher signal yields a strictly
 * higher share, every share lies in 0.0 to 1.0 rounded to 4 decimal places, and
 * the shares sum to 1.0 within a tolerance of 0.001.
 *
 * `suggestedTimeAllocation` is pure and database-free, so this test needs no
 * mocks; it exercises the real signal-proportional distribution across generated
 * pending-Chapter sets. To avoid a filename collision with tasks 6.3–6.5 (which
 * test Properties 8–10 against the same module), this property lives in its own
 * `*.sum.property.test.ts`.
 *
 * fast-check assertions run a minimum of 100 iterations each.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    suggestedTimeAllocation,
    type SuggestedChapterInput,
} from './allocation';
import type { ChapterStatus } from './frequency';

/** Tolerance the design fixes for the shares-sum-to-one invariant (Req 5.3, 6.1). */
const SUM_TOLERANCE = 0.001;

/** A pending Chapter_Status (only these participate in the allocation; Req 5.2). */
const pendingStatusArb: fc.Arbitrary<ChapterStatus> = fc.constantFrom(
    'NOT_STARTED',
    'IN_PROGRESS',
);

/** Round to 4 decimal places, mirroring the module's share rounding (Req 5.3). */
function round4(value: number): number {
    return Math.round(value * 10_000) / 10_000;
}

/**
 * A pending Chapter that carries data (so it is never treated as data-less and
 * never falls back to weightage) and a *strictly positive* Combined_Weightage_Signal,
 * with no User override — exactly the regime Property 7 quantifies over. The
 * positive signal keeps every Chapter on the proportional `COMBINED_SIGNAL`
 * branch where `share == signal / Σsignal` holds.
 */
function positiveSignalChapterArb(index: number): fc.Arbitrary<SuggestedChapterInput> {
    return fc.record({
        chapterId: fc.constant(`ch-${String(index).padStart(2, '0')}`),
        referenceKey: fc.constant(`k${String(index).padStart(2, '0')}`),
        pyqFrequency: fc.double({ min: 1, max: 500, noNaN: true, noDefaultInfinity: true }),
        historicalFrequency: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        hasHistoricalData: fc.constant(true),
        rawSignal: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        combinedWeightageSignal: fc.double({
            min: 0.001,
            max: 1,
            noNaN: true,
            noDefaultInfinity: true,
        }),
        status: pendingStatusArb,
        weightage: fc.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
        weightageIsDefault: fc.boolean(),
        timeAllocationOverride: fc.constant(null),
    });
}

/** A non-empty set of positive-signal, override-free pending Chapters. */
const positiveSignalSetArb: fc.Arbitrary<SuggestedChapterInput[]> = fc
    .integer({ min: 1, max: 10 })
    .chain((count) =>
        fc.tuple(
            ...Array.from({ length: count }, (_unused, index) =>
                positiveSignalChapterArb(index),
            ),
        ),
    )
    .map((entries) => [...entries]);

/**
 * A pending Chapter with an arbitrary non-negative signal (possibly zero) and a
 * positive weightage so the weightage fallback is always well-defined; never
 * overridden. Used for the broader sum-to-one invariant across the full pending
 * input space.
 */
function anyPendingChapterArb(index: number): fc.Arbitrary<SuggestedChapterInput> {
    return fc.record({
        chapterId: fc.constant(`ch-${String(index).padStart(2, '0')}`),
        referenceKey: fc.constant(`k${String(index).padStart(2, '0')}`),
        pyqFrequency: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        historicalFrequency: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        hasHistoricalData: fc.boolean(),
        rawSignal: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        combinedWeightageSignal: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        status: pendingStatusArb,
        weightage: fc.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
        weightageIsDefault: fc.boolean(),
        timeAllocationOverride: fc.constant(null),
    });
}

/** A non-empty set of arbitrary, override-free pending Chapters. */
const anyPendingSetArb: fc.Arbitrary<SuggestedChapterInput[]> = fc
    .integer({ min: 1, max: 10 })
    .chain((count) =>
        fc.tuple(
            ...Array.from({ length: count }, (_unused, index) =>
                anyPendingChapterArb(index),
            ),
        ),
    )
    .map((entries) => [...entries]);

describe('suggestedTimeAllocation proportionality and sum-to-one (Property 7)', () => {
    // Feature: weightage-based-time-allocation, Property 7: Suggested allocation
    // shares are proportional and sum to one
    it('Property 7: shares equal signal / Σsignal, are proportional, and sum to 1.0 (Req 5.1, 5.3, 6.1)', () => {
        fc.assert(
            fc.property(positiveSignalSetArb, (inputs) => {
                const shares = suggestedTimeAllocation(inputs);

                // Every pending Chapter appears exactly once.
                expect(shares).toHaveLength(inputs.length);

                const sumSignal = inputs.reduce(
                    (sum, chapter) => sum + chapter.combinedWeightageSignal,
                    0,
                );
                expect(sumSignal).toBeGreaterThan(0);

                const signalByChapter = new Map(
                    inputs.map((chapter) => [chapter.chapterId, chapter.combinedWeightageSignal]),
                );

                for (const share of shares) {
                    // Each share lies in the inclusive range [0, 1] (Req 5.3).
                    expect(share.allocationShare).toBeGreaterThanOrEqual(0);
                    expect(share.allocationShare).toBeLessThanOrEqual(1);

                    // Each share is rounded to 4 decimal places (Req 5.3).
                    expect(share.allocationShare).toBe(round4(share.allocationShare));

                    // share == Combined_Weightage_Signal / Σsignal, within the
                    // rounding/residue tolerance the design fixes at 0.001 (Req 5.1).
                    const signal = signalByChapter.get(share.chapterId) as number;
                    const expected = signal / sumSignal;
                    expect(Math.abs(share.allocationShare - expected)).toBeLessThanOrEqual(
                        SUM_TOLERANCE,
                    );
                }

                // The shares sum to 1.0 within a tolerance of 0.001 (Req 5.3, 6.1).
                const total = shares.reduce((sum, share) => sum + share.allocationShare, 0);
                expect(Math.abs(total - 1)).toBeLessThanOrEqual(SUM_TOLERANCE);

                // A strictly higher signal yields a higher-or-equal share, i.e. the
                // distribution is monotonic in the signal (Req 5.1). Strict equality
                // can only arise when two shares collapse to the same 4-dp value.
                const sorted = [...shares].sort((a, b) => {
                    const sa = signalByChapter.get(a.chapterId) as number;
                    const sb = signalByChapter.get(b.chapterId) as number;
                    return sa - sb;
                });
                for (let i = 1; i < sorted.length; i += 1) {
                    expect(sorted[i].allocationShare).toBeGreaterThanOrEqual(
                        sorted[i - 1].allocationShare,
                    );
                }
            }),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 7: Suggested allocation
    // shares are proportional and sum to one
    it('Property 7: for any non-empty pending set the shares are in [0,1] and sum to 1.0 (Req 5.3, 6.1)', () => {
        fc.assert(
            fc.property(anyPendingSetArb, (inputs) => {
                const shares = suggestedTimeAllocation(inputs);

                expect(shares).toHaveLength(inputs.length);

                for (const share of shares) {
                    expect(share.allocationShare).toBeGreaterThanOrEqual(0);
                    expect(share.allocationShare).toBeLessThanOrEqual(1);
                    expect(share.allocationShare).toBe(round4(share.allocationShare));
                }

                const total = shares.reduce((sum, share) => sum + share.allocationShare, 0);
                expect(Math.abs(total - 1)).toBeLessThanOrEqual(SUM_TOLERANCE);
            }),
            { numRuns: 100 },
        );
    });
});
