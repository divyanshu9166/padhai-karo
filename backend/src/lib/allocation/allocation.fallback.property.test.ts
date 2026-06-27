/**
 * Property-based test for the Chapter_Weightage fallback (task 6.4; design
 * "Correctness Properties → Property 9").
 *
 *   - Property 9: Chapter_Weightage fallback retains and labels data-less Chapters
 *     Validates: Requirements 5.4, 6.1, 6.2, 6.3, 6.5
 *
 * Property 9 (design statement): For any pending Chapter that has a
 * `PYQ_Chapter_Frequency` of zero and no historical record (or any set whose
 * signals are all zero), the Chapter's `Allocation_Share` is derived in
 * proportion to its effective Phase 1 `Chapter_Weightage` (normalized so all
 * pending shares sum to 1.0 within 0.001), the Chapter is labeled as originating
 * from the `Chapter_Weightage` fallback, its `weightageIsDefault` flag is
 * preserved, and a fallback Chapter whose weightage is absent or zero receives
 * the smallest non-zero `Allocation_Share` among the pending Chapters and is
 * retained rather than dropped.
 *
 * `suggestedTimeAllocation` is pure and database-free, so this test needs no
 * mocks: it exercises the real fallback math across generated Chapter sets. None
 * of the Chapters carry a Time_Allocation_Override here — override precedence is
 * the subject of Property 10 (task 6.5). Two fallback regimes are covered:
 *   - the *global* fallback (Req 5.4): every pending Chapter's signal is zero, so
 *     the whole set is distributed by Chapter_Weightage;
 *   - the *per-Chapter* fallback (Req 6.1, 6.2): data-less Chapters (zero PYQ
 *     frequency AND no historical record) fall back to weightage while
 *     data-bearing Chapters are distributed by their combined signal.
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

/** Sum tolerance required by Req 5.4 / 6.1 ("sum to 1.0 within 0.001"). */
const SUM_TOLERANCE = 0.001;
/** A generous slack covering 4-dp rounding plus residue absorption across a set. */
const ROUNDING_SLACK = 0.0011;

/** Only Not Started / In Progress Chapters participate (Req 5.2). */
const pendingStatusArb: fc.Arbitrary<ChapterStatus> = fc.constantFrom(
    'NOT_STARTED',
    'IN_PROGRESS',
);

/** A strictly positive effective Chapter_Weightage (kept small for clean ratios). */
const positiveWeightageArb = fc.integer({ min: 1, max: 10 });
/** An absent or zero Chapter_Weightage — the Req 6.5 retention case. */
const zeroOrAbsentWeightageArb = fc.oneof(
    fc.constant<number | null>(0),
    fc.constant<number | null>(null),
);

/**
 * The per-Chapter fields a generated spec carries, minus the identity fields
 * (`chapterId`/`referenceKey`) which {@link finalize} assigns by index so every
 * Chapter in a generated set is distinct.
 */
type ChapterSpec = Omit<SuggestedChapterInput, 'chapterId' | 'referenceKey'>;

/** Assign distinct ids/referenceKeys to a set of specs. */
function finalize(specs: readonly ChapterSpec[]): SuggestedChapterInput[] {
    return specs.map((spec, index) => ({
        chapterId: `ch-${index}`,
        referenceKey: `k${String(index).padStart(3, '0')}`,
        ...spec,
    }));
}

/**
 * A *data-less* pending Chapter: zero PYQ frequency, no historical record, and a
 * zero combined signal (its real-pipeline value). Triggers the Chapter_Weightage
 * fallback (Req 6.1). The weightage is supplied by the caller so each test can
 * target positive vs. absent/zero weightage.
 */
function dataLessSpecArb(
    weightageArb: fc.Arbitrary<number | null>,
): fc.Arbitrary<ChapterSpec> {
    return fc.record({
        pyqFrequency: fc.constant(0),
        historicalFrequency: fc.constant(0),
        hasHistoricalData: fc.constant(false),
        rawSignal: fc.constant(0),
        combinedWeightageSignal: fc.constant(0),
        status: pendingStatusArb,
        weightage: weightageArb,
        weightageIsDefault: fc.boolean(),
    });
}

/**
 * A *data-bearing* pending Chapter: positive PYQ frequency (so it is not
 * data-less) and a strictly positive combined signal, so it is distributed by
 * the Combined_Weightage_Signal and labeled COMBINED_SIGNAL.
 */
const dataRichSpecArb: fc.Arbitrary<ChapterSpec> = fc.record({
    pyqFrequency: fc.integer({ min: 1, max: 10 }),
    historicalFrequency: fc.integer({ min: 0, max: 10 }),
    hasHistoricalData: fc.boolean(),
    rawSignal: fc.double({ min: 0.5, max: 10, noNaN: true }),
    combinedWeightageSignal: fc.double({ min: 0.01, max: 1, noNaN: true }),
    status: pendingStatusArb,
    weightage: fc.integer({ min: 1, max: 10 }),
    weightageIsDefault: fc.boolean(),
});

/** Sum of every Chapter's Allocation_Share. */
function shareSum(shares: readonly { allocationShare: number }[]): number {
    return shares.reduce((sum, s) => sum + s.allocationShare, 0);
}

describe('suggestedTimeAllocation Chapter_Weightage fallback (Property 9)', () => {
    // Feature: weightage-based-time-allocation, Property 9: Chapter_Weightage
    // fallback retains and labels data-less Chapters
    it('Property 9: all-zero-signal sets distribute by weightage, labeled, summing to 1.0 (Req 5.4, 6.1, 6.2)', () => {
        fc.assert(
            fc.property(
                fc
                    .array(
                        dataLessSpecArb(
                            fc.oneof(positiveWeightageArb, zeroOrAbsentWeightageArb),
                        ),
                        { minLength: 1, maxLength: 8 },
                    )
                    .map(finalize),
                (chapters) => {
                    const result = suggestedTimeAllocation(chapters);

                    // Every pending Chapter is included exactly once (Req 6.4).
                    expect(result).toHaveLength(chapters.length);
                    expect(new Set(result.map((s) => s.chapterId))).toEqual(
                        new Set(chapters.map((c) => c.chapterId)),
                    );

                    // Every share originates from the Chapter_Weightage fallback (Req 6.2).
                    for (const share of result) {
                        expect(share.source).toBe('WEIGHTAGE_FALLBACK');
                    }

                    // Shares sum to 1.0 within tolerance (Req 5.4, 6.1).
                    expect(Math.abs(shareSum(result) - 1)).toBeLessThanOrEqual(
                        SUM_TOLERANCE,
                    );

                    // weightageIsDefault is preserved from the input (Req 6.3), and no
                    // Chapter is dropped — each retains a non-zero share (Req 6.5).
                    const byId = new Map(chapters.map((c) => [c.chapterId, c]));
                    for (const share of result) {
                        expect(share.weightageIsDefault).toBe(
                            byId.get(share.chapterId)?.weightageIsDefault,
                        );
                        expect(share.allocationShare).toBeGreaterThan(0);
                    }

                    // Proportionality (Req 5.4): a Chapter with a strictly greater
                    // positive weightage never receives a smaller share.
                    const positives = result
                        .map((share) => ({
                            share: share.allocationShare,
                            weightage: byId.get(share.chapterId)?.weightage ?? 0,
                        }))
                        .filter((entry) => (entry.weightage ?? 0) > 0);
                    for (const a of positives) {
                        for (const b of positives) {
                            if ((a.weightage as number) > (b.weightage as number)) {
                                expect(a.share).toBeGreaterThanOrEqual(
                                    b.share - ROUNDING_SLACK,
                                );
                            }
                        }
                    }
                },
            ),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 9: Chapter_Weightage
    // fallback retains and labels data-less Chapters
    it('Property 9: absent/zero-weightage fallback Chapters get the smallest non-zero share and are retained (Req 6.5)', () => {
        fc.assert(
            fc.property(
                fc
                    .tuple(
                        // At least one positive-weightage fallback Chapter ...
                        fc.array(dataLessSpecArb(positiveWeightageArb), {
                            minLength: 1,
                            maxLength: 5,
                        }),
                        // ... and at least one absent/zero-weightage fallback Chapter.
                        fc.array(dataLessSpecArb(zeroOrAbsentWeightageArb), {
                            minLength: 1,
                            maxLength: 5,
                        }),
                    )
                    .map(([positives, zeros]) => finalize([...positives, ...zeros])),
                (chapters) => {
                    const result = suggestedTimeAllocation(chapters);
                    const byId = new Map(chapters.map((c) => [c.chapterId, c]));

                    const minShare = Math.min(
                        ...result.map((s) => s.allocationShare),
                    );

                    for (const share of result) {
                        const weightage = byId.get(share.chapterId)?.weightage ?? null;
                        const isAbsentOrZero =
                            weightage === null || weightage === 0;
                        if (isAbsentOrZero) {
                            // Retained (never dropped) ...
                            expect(share.allocationShare).toBeGreaterThan(0);
                            // ... with the smallest non-zero share among pending Chapters.
                            expect(
                                Math.abs(share.allocationShare - minShare),
                            ).toBeLessThanOrEqual(ROUNDING_SLACK);
                            // ... never exceeding any positive-weightage Chapter's share.
                            for (const other of result) {
                                const otherW =
                                    byId.get(other.chapterId)?.weightage ?? 0;
                                if ((otherW ?? 0) > 0) {
                                    expect(share.allocationShare).toBeLessThanOrEqual(
                                        other.allocationShare + ROUNDING_SLACK,
                                    );
                                }
                            }
                        }
                    }

                    // Still a valid distribution summing to 1.0 (Req 6.1).
                    expect(Math.abs(shareSum(result) - 1)).toBeLessThanOrEqual(
                        SUM_TOLERANCE,
                    );
                },
            ),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 9: Chapter_Weightage
    // fallback retains and labels data-less Chapters
    it('Property 9: in a mixed set, data-less Chapters fall back while data-bearing Chapters use the signal (Req 6.1, 6.2, 6.3)', () => {
        fc.assert(
            fc.property(
                fc
                    .tuple(
                        fc.array(dataRichSpecArb, { minLength: 1, maxLength: 5 }),
                        fc.array(
                            dataLessSpecArb(
                                fc.oneof(positiveWeightageArb, zeroOrAbsentWeightageArb),
                            ),
                            { minLength: 1, maxLength: 5 },
                        ),
                    )
                    .map(([rich, less]) => {
                        // Interleave so input order does not coincide with the kind.
                        const merged: ChapterSpec[] = [];
                        const max = Math.max(rich.length, less.length);
                        for (let i = 0; i < max; i++) {
                            if (i < rich.length) merged.push(rich[i]);
                            if (i < less.length) merged.push(less[i]);
                        }
                        return finalize(merged);
                    }),
                (chapters) => {
                    const result = suggestedTimeAllocation(chapters);
                    const byId = new Map(chapters.map((c) => [c.chapterId, c]));

                    // Coverage: every pending Chapter once (Req 6.4).
                    expect(result).toHaveLength(chapters.length);
                    expect(new Set(result.map((s) => s.chapterId))).toEqual(
                        new Set(chapters.map((c) => c.chapterId)),
                    );

                    for (const share of result) {
                        const input = byId.get(share.chapterId);
                        const isDataLess =
                            (input?.pyqFrequency ?? 0) <= 0 &&
                            input?.hasHistoricalData !== true;
                        if (isDataLess) {
                            // Data-less Chapters originate from the weightage fallback (Req 6.1, 6.2).
                            expect(share.source).toBe('WEIGHTAGE_FALLBACK');
                        } else {
                            // Data-bearing Chapters are distributed by the combined signal.
                            expect(share.source).toBe('COMBINED_SIGNAL');
                        }
                        // weightageIsDefault preserved regardless of source (Req 6.3).
                        expect(share.weightageIsDefault).toBe(input?.weightageIsDefault);
                    }

                    // The combined distribution still sums to 1.0 (Req 6.1).
                    expect(Math.abs(shareSum(result) - 1)).toBeLessThanOrEqual(
                        SUM_TOLERANCE,
                    );
                },
            ),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 9: Chapter_Weightage
    // fallback retains and labels data-less Chapters
    it('Property 9: computing the fallback never mutates the input Chapters', () => {
        fc.assert(
            fc.property(
                fc
                    .array(
                        dataLessSpecArb(
                            fc.oneof(positiveWeightageArb, zeroOrAbsentWeightageArb),
                        ),
                        { minLength: 1, maxLength: 8 },
                    )
                    .map(finalize),
                (chapters) => {
                    const snapshot = JSON.stringify(chapters);
                    suggestedTimeAllocation(chapters);
                    expect(JSON.stringify(chapters)).toBe(snapshot);
                },
            ),
            { numRuns: 100 },
        );
    });
});
