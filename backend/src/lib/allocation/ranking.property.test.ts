/**
 * Property-based test for Most_Frequent_Chapters ordering (task 5.2; design
 * "Correctness Properties → Property 5").
 *
 *   - Property 5: Most_Frequent_Chapters ordering is total and deterministic
 *     Validates: Requirements 4.1, 4.3, 4.4, 4.5, 4.6
 *
 * Property 5 (design statement): For any set of Chapters, the
 * `Most_Frequent_Chapters` list contains every Chapter ordered by
 * `Combined_Weightage_Signal` descending, breaking ties by
 * `Historical_Chapter_Frequency` descending, then by `PYQ_Chapter_Frequency`
 * descending, then by Chapter `referenceKey` in ascending lexicographic order,
 * producing the same order regardless of input order; an empty Chapter set
 * yields an empty list.
 *
 * `mostFrequentChapters` is pure and database-free, so this test needs no mocks.
 * It exercises the real cascade ordering across generated Chapter sets. The
 * frequency/signal fields are drawn from a deliberately small value space so
 * ties on each cascade level (and therefore the lower tiebreaks) are exercised
 * frequently rather than being vanishingly rare.
 *
 * fast-check assertions run a minimum of 100 iterations each.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { mostFrequentChapters } from './ranking';
import type { ChapterSignal } from './signal';

/**
 * Small-domain value generator: keeping the range tight (0..3) makes equal
 * values across Chapters common, which forces the tie-break cascade (Req 4.3,
 * 4.4, 4.5) to be exercised on most generated inputs.
 */
const smallValueArb = fc.integer({ min: 0, max: 3 });

/** A single fully-formed ChapterSignal with a caller-supplied unique referenceKey. */
function chapterSignalArb(referenceKey: string): fc.Arbitrary<ChapterSignal> {
    return fc.record({
        chapterId: fc.constant(`ch-${referenceKey}`),
        referenceKey: fc.constant(referenceKey),
        pyqFrequency: smallValueArb,
        historicalFrequency: smallValueArb,
        hasHistoricalData: fc.boolean(),
        rawSignal: smallValueArb.map((v) => v as number),
        combinedWeightageSignal: smallValueArb,
    });
}

/** A set of Chapters with distinct referenceKeys (mirrors the unique Phase 1 key). */
const chapterSignalSetArb: fc.Arbitrary<ChapterSignal[]> = fc
    .integer({ min: 0, max: 12 })
    .chain((count) =>
        count === 0
            ? fc.constant<ChapterSignal[]>([])
            : fc.tuple(
                ...Array.from({ length: count }, (_unused, index) =>
                    chapterSignalArb(`k${String(index).padStart(2, '0')}`),
                ),
            ),
    )
    .map((entries) => [...entries]);

/**
 * The cascade comparator the ranking is expected to implement. Returns a
 * negative number when `a` must precede `b`, positive when `b` must precede `a`,
 * and 0 only when every key is equal (which, with distinct referenceKeys, never
 * happens for two distinct Chapters).
 */
function expectedCascade(a: ChapterSignal, b: ChapterSignal): number {
    if (b.combinedWeightageSignal !== a.combinedWeightageSignal) {
        return b.combinedWeightageSignal - a.combinedWeightageSignal;
    }
    if (b.historicalFrequency !== a.historicalFrequency) {
        return b.historicalFrequency - a.historicalFrequency;
    }
    if (b.pyqFrequency !== a.pyqFrequency) {
        return b.pyqFrequency - a.pyqFrequency;
    }
    if (a.referenceKey < b.referenceKey) {
        return -1;
    }
    if (a.referenceKey > b.referenceKey) {
        return 1;
    }
    return 0;
}

/** Deterministically permute an array using a supplied permutation of indices. */
function permute<T>(items: readonly T[], permutation: readonly number[]): T[] {
    return permutation.map((index) => items[index]);
}

describe('mostFrequentChapters ordering (Property 5)', () => {
    // Feature: weightage-based-time-allocation, Property 5: Most_Frequent_Chapters
    // ordering is total and deterministic
    it('Property 5: every adjacent pair respects the total cascade ordering (Req 4.1, 4.3, 4.4, 4.5)', () => {
        fc.assert(
            fc.property(chapterSignalSetArb, (signals) => {
                const ranked = mostFrequentChapters(signals);

                // Totality: the result contains exactly the input Chapters, once each.
                expect(ranked).toHaveLength(signals.length);
                expect(new Set(ranked.map((s) => s.referenceKey))).toEqual(
                    new Set(signals.map((s) => s.referenceKey)),
                );

                // Every adjacent pair is ordered by the cascade: the earlier element
                // must not be required to come after the later one.
                for (let i = 0; i + 1 < ranked.length; i++) {
                    expect(expectedCascade(ranked[i], ranked[i + 1])).toBeLessThanOrEqual(0);
                }
            }),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 5: Most_Frequent_Chapters
    // ordering is total and deterministic
    it('Property 5: ranking is invariant under input permutation (Req 4.1, 4.5 determinism)', () => {
        fc.assert(
            fc.property(
                chapterSignalSetArb.chain((signals) =>
                    fc.tuple(
                        fc.constant(signals),
                        // A random permutation of the input indices.
                        signals.length <= 1
                            ? fc.constant(signals.map((_unused, index) => index))
                            : fc.shuffledSubarray(
                                signals.map((_unused, index) => index),
                                { minLength: signals.length, maxLength: signals.length },
                            ),
                    ),
                ),
                ([signals, permutation]) => {
                    const rankedOriginal = mostFrequentChapters(signals);
                    const rankedPermuted = mostFrequentChapters(permute(signals, permutation));

                    // Determinism: the same Chapters arrive in the same order regardless
                    // of input order — compare the deterministic referenceKey sequence.
                    expect(rankedPermuted.map((s) => s.referenceKey)).toEqual(
                        rankedOriginal.map((s) => s.referenceKey),
                    );
                },
            ),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 5: Most_Frequent_Chapters
    // ordering is total and deterministic
    it('Property 5: an empty Chapter set yields an empty list (Req 4.6)', () => {
        expect(mostFrequentChapters([])).toEqual([]);
    });

    // Feature: weightage-based-time-allocation, Property 5: Most_Frequent_Chapters
    // ordering is total and deterministic
    it('Property 5: does not mutate its input array or order', () => {
        fc.assert(
            fc.property(chapterSignalSetArb, (signals) => {
                const snapshot = signals.map((s) => s.referenceKey);
                mostFrequentChapters(signals);
                // The input array order is preserved (ranking sorts a copy).
                expect(signals.map((s) => s.referenceKey)).toEqual(snapshot);
            }),
            { numRuns: 100 },
        );
    });
});
