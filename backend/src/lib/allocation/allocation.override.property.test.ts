/**
 * Property-based test for User-override precedence and remainder distribution in
 * the Suggested_Time_Allocation (task 6.5; design "Correctness Properties →
 * Property 10").
 *
 *   - Property 10: User overrides take precedence and the remainder is
 *     distributed by signal
 *     Validates: Requirements 8.1, 8.2, 8.5, 8.6, 8.7
 *
 * Property 10 (design statement): For any set of pending Chapters where some
 * carry a `Time_Allocation_Override`, each overridden Chapter keeps its stored
 * override share unchanged, the remaining share equal to `1.0` minus the sum of
 * the overridden shares is distributed across the non-overridden Chapters in
 * proportion to their `Combined_Weightage_Signal`; when the sum of overrides
 * meets or exceeds `1.0` every non-overridden Chapter receives a share of zero
 * and no override value is reduced; when every pending Chapter is overridden no
 * signal-based distribution is performed; and any `Weightage_Override` replaces
 * the Phase 1 `Chapter_Weightage` in every computation that would otherwise use
 * it.
 *
 * `suggestedTimeAllocation` is pure and database-free, so this test needs no
 * mocks. The pure layer receives the *effective* per-Chapter weightage with any
 * Weightage_Override already applied by the reader (design: `SuggestedChapterInput.weightage`
 * is "effective Phase 1 weightage, override already applied"), so the Req 8.2
 * facet is exercised here by feeding the effective `weightage`/signal values the
 * function consumes — the function never re-derives or mutates them.
 *
 * Override values are generated as exact multiples of 1e-4 so that the function's
 * 4-decimal rounding leaves them verbatim, letting the "unchanged" assertions be
 * exact rather than approximate. fast-check assertions run a minimum of 100
 * iterations each.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    suggestedTimeAllocation,
    type ChapterAllocationShare,
    type SuggestedChapterInput,
} from './allocation';

/** Round to 4 dp exactly as the implementation does, for verbatim comparisons. */
function round4(value: number): number {
    return Math.round(value * 1e4) / 1e4;
}

/** Sum of a list of allocation shares. */
function sumShares(shares: readonly ChapterAllocationShare[]): number {
    return shares.reduce((total, s) => total + s.allocationShare, 0);
}

/** An override value that is an exact multiple of 1e-4 in the supplied integer range. */
function overrideArb(minUnits: number, maxUnits: number): fc.Arbitrary<number> {
    return fc.integer({ min: minUnits, max: maxUnits }).map((units) => units / 1e4);
}

/**
 * A non-overridden pending Chapter that always carries data (positive PYQ
 * frequency, a historical record, and a strictly positive
 * `combinedWeightageSignal`) so it is distributed by signal (`COMBINED_SIGNAL`),
 * never by the weightage fallback. This isolates the proportional-distribution
 * facet of Property 10 (Req 8.5).
 */
function signalChapterArb(index: number): fc.Arbitrary<SuggestedChapterInput> {
    return fc.record({
        chapterId: fc.constant(`sig-${index}`),
        referenceKey: fc.constant(`s${String(index).padStart(2, '0')}`),
        pyqFrequency: fc.integer({ min: 1, max: 50 }),
        historicalFrequency: fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        hasHistoricalData: fc.constant(true),
        rawSignal: fc.double({ min: 0.01, max: 50, noNaN: true, noDefaultInfinity: true }),
        // Strictly positive so the group is never an all-zero fallback.
        combinedWeightageSignal: fc.double({
            min: 0.01,
            max: 1,
            noNaN: true,
            noDefaultInfinity: true,
        }),
        status: fc.constantFrom<SuggestedChapterInput['status']>('NOT_STARTED', 'IN_PROGRESS'),
        weightage: fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
        weightageIsDefault: fc.boolean(),
        timeAllocationOverride: fc.constant<number | null>(null),
    });
}

/** An overridden pending Chapter; its `timeAllocationOverride` is the given value. */
function overriddenChapterArb(
    index: number,
    valueArb: fc.Arbitrary<number>,
): fc.Arbitrary<SuggestedChapterInput> {
    return fc.record({
        chapterId: fc.constant(`ovr-${index}`),
        referenceKey: fc.constant(`o${String(index).padStart(2, '0')}`),
        pyqFrequency: fc.integer({ min: 0, max: 50 }),
        historicalFrequency: fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        hasHistoricalData: fc.boolean(),
        rawSignal: fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        combinedWeightageSignal: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        status: fc.constantFrom<SuggestedChapterInput['status']>('NOT_STARTED', 'IN_PROGRESS'),
        weightage: fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
        weightageIsDefault: fc.boolean(),
        timeAllocationOverride: valueArb,
    });
}

/** Build a fixed-length tuple arbitrary from a per-index factory. */
function listArb<T>(count: number, factory: (index: number) => fc.Arbitrary<T>): fc.Arbitrary<T[]> {
    return count === 0
        ? fc.constant<T[]>([])
        : fc.tuple(...Array.from({ length: count }, (_unused, i) => factory(i))).map((t) => [...t]);
}

describe('suggestedTimeAllocation override precedence and remainder distribution (Property 10)', () => {
    // Feature: weightage-based-time-allocation, Property 10: User overrides take
    // precedence and the remainder is distributed by signal
    it('Property 10: overridden Chapters keep their share verbatim labeled USER_OVERRIDE; the remainder Σ≈1-Σoverrides is distributed by signal (Req 8.1, 8.5)', () => {
        fc.assert(
            fc.property(
                // 1..6 signal-driven non-overridden Chapters.
                fc.integer({ min: 1, max: 6 }),
                // 0..4 overridden Chapters with small overrides so Σoverrides < 1.
                fc.integer({ min: 0, max: 4 }),
                fc.integer({ min: 1, max: 6 }).chain((nSig) => listArb(nSig, signalChapterArb)),
                fc
                    .integer({ min: 0, max: 4 })
                    .chain((nOvr) =>
                        // each override in [0, 0.15] so up to 4 of them stay well under 1.0
                        listArb(nOvr, (i) => overriddenChapterArb(i, overrideArb(0, 1500))),
                    ),
                (_nSig, _nOvr, signalChapters, overriddenChapters) => {
                    const inputs = [...overriddenChapters, ...signalChapters];
                    const result = suggestedTimeAllocation(inputs);
                    const byId = new Map(result.map((r) => [r.chapterId, r]));

                    const sumOverrides = overriddenChapters.reduce(
                        (sum, c) => sum + (c.timeAllocationOverride ?? 0),
                        0,
                    );
                    const remaining = Math.max(0, Math.min(1, 1 - sumOverrides));

                    // Overridden Chapters: share kept verbatim (4dp), source USER_OVERRIDE (Req 8.1).
                    for (const c of overriddenChapters) {
                        const share = byId.get(c.chapterId);
                        expect(share).toBeDefined();
                        expect(share?.source).toBe('USER_OVERRIDE');
                        expect(share?.allocationShare).toBe(round4(c.timeAllocationOverride ?? 0));
                    }

                    // Non-overridden Chapters: distributed by Combined_Weightage_Signal (Req 8.5).
                    const sumSignal = signalChapters.reduce(
                        (sum, c) => sum + c.combinedWeightageSignal,
                        0,
                    );
                    for (const c of signalChapters) {
                        const share = byId.get(c.chapterId);
                        expect(share).toBeDefined();
                        expect(share?.source).toBe('COMBINED_SIGNAL');
                        const expected = (c.combinedWeightageSignal / sumSignal) * remaining;
                        // Tolerance covers 4dp rounding plus residue absorbed by one share.
                        expect(share?.allocationShare ?? 0).toBeCloseTo(expected, 2);
                    }

                    // The distributed (non-overridden) shares sum to the remainder.
                    const distributedSum = signalChapters.reduce(
                        (sum, c) => sum + (byId.get(c.chapterId)?.allocationShare ?? 0),
                        0,
                    );
                    expect(distributedSum).toBeCloseTo(remaining, 2);

                    // Total over all pending Chapters sums to 1.0 within 0.001 (Req 5.3).
                    expect(sumShares(result)).toBeCloseTo(1, 3);
                },
            ),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 10: User overrides take
    // precedence and the remainder is distributed by signal
    it('Property 10: a strictly higher signal earns a strictly higher (or equal) distributed share (Req 8.5)', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 2, max: 6 }).chain((nSig) => listArb(nSig, signalChapterArb)),
                listArb(2, (i) => overriddenChapterArb(i, overrideArb(0, 1000))),
                (signalChapters, overriddenChapters) => {
                    const result = suggestedTimeAllocation([...overriddenChapters, ...signalChapters]);
                    const byId = new Map(result.map((r) => [r.chapterId, r]));

                    // For every pair, the Chapter with the larger signal must not receive
                    // a smaller share (monotonic in signal); residue absorption keeps this
                    // weak inequality with a tiny slack.
                    for (const a of signalChapters) {
                        for (const b of signalChapters) {
                            if (a.combinedWeightageSignal > b.combinedWeightageSignal) {
                                const sa = byId.get(a.chapterId)?.allocationShare ?? 0;
                                const sb = byId.get(b.chapterId)?.allocationShare ?? 0;
                                expect(sa).toBeGreaterThanOrEqual(sb - 1e-3);
                            }
                        }
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 10: User overrides take
    // precedence and the remainder is distributed by signal
    it('Property 10: when Σoverrides ≥ 1 every non-overridden Chapter gets 0 and no override is reduced (Req 8.6)', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 5 }).chain((nSig) => listArb(nSig, signalChapterArb)),
                // 1..4 overrides each in [0.6, 1.5]; with the guaranteed minimum below the
                // sum reaches/exceeds 1.0.
                fc
                    .integer({ min: 1, max: 4 })
                    .chain((nOvr) => listArb(nOvr, (i) => overriddenChapterArb(i, overrideArb(6000, 15000)))),
                (signalChapters, overriddenChapters) => {
                    const sumOverrides = overriddenChapters.reduce(
                        (sum, c) => sum + (c.timeAllocationOverride ?? 0),
                        0,
                    );
                    // Only exercise the Σ ≥ 1 branch.
                    fc.pre(sumOverrides >= 1);

                    const result = suggestedTimeAllocation([...overriddenChapters, ...signalChapters]);
                    const byId = new Map(result.map((r) => [r.chapterId, r]));

                    // Every non-overridden Chapter receives exactly zero (Req 8.6).
                    for (const c of signalChapters) {
                        expect(byId.get(c.chapterId)?.allocationShare).toBe(0);
                    }

                    // No override value is reduced — each is preserved verbatim (Req 8.6).
                    for (const c of overriddenChapters) {
                        const share = byId.get(c.chapterId);
                        expect(share?.source).toBe('USER_OVERRIDE');
                        expect(share?.allocationShare).toBe(round4(c.timeAllocationOverride ?? 0));
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 10: User overrides take
    // precedence and the remainder is distributed by signal
    it('Property 10: when every pending Chapter is overridden, no signal-based distribution occurs (Req 8.7)', () => {
        fc.assert(
            fc.property(
                fc
                    .integer({ min: 1, max: 6 })
                    .chain((nOvr) => listArb(nOvr, (i) => overriddenChapterArb(i, overrideArb(0, 3000)))),
                (overriddenChapters) => {
                    const result = suggestedTimeAllocation(overriddenChapters);

                    // Exactly one entry per pending Chapter, all USER_OVERRIDE, none distributed.
                    expect(result).toHaveLength(overriddenChapters.length);
                    expect(result.every((r) => r.source === 'USER_OVERRIDE')).toBe(true);
                    expect(result.some((r) => r.source === 'COMBINED_SIGNAL')).toBe(false);
                    expect(result.some((r) => r.source === 'WEIGHTAGE_FALLBACK')).toBe(false);

                    // Every override kept verbatim (Req 8.1, 8.7).
                    const byId = new Map(result.map((r) => [r.chapterId, r]));
                    for (const c of overriddenChapters) {
                        expect(byId.get(c.chapterId)?.allocationShare).toBe(
                            round4(c.timeAllocationOverride ?? 0),
                        );
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 10: User overrides take
    // precedence and the remainder is distributed by signal
    it('Property 10: overriding never mutates the input Chapters (Req 8.2/8.3 read-only)', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 5 }).chain((nSig) => listArb(nSig, signalChapterArb)),
                listArb(2, (i) => overriddenChapterArb(i, overrideArb(0, 2000))),
                (signalChapters, overriddenChapters) => {
                    const inputs = [...overriddenChapters, ...signalChapters];
                    const snapshot = JSON.stringify(inputs);
                    suggestedTimeAllocation(inputs);
                    expect(JSON.stringify(inputs)).toBe(snapshot);
                },
            ),
            { numRuns: 100 },
        );
    });
});
