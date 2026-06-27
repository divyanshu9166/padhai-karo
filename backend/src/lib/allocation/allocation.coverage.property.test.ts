/**
 * Property-based test for pending-chapter coverage of the Suggested_Time_Allocation
 * (task 6.3; design "Correctness Properties → Property 8").
 *
 *   - Property 8: Suggested allocation covers exactly the pending Chapters once
 *     Validates: Requirements 5.2, 6.4, 5.5
 *
 * Property 8 (design statement): For any set of Chapters, the
 * `Suggested_Time_Allocation` includes every Chapter whose `Chapter_Status` is
 * Not Started or In Progress exactly once and excludes every Chapter whose status
 * is neither; when there are no pending Chapters the allocation is empty.
 *
 * `suggestedTimeAllocation` is pure and database-free, so this test needs no
 * mocks. It exercises the real coverage behavior across generated Chapter sets
 * mixing pending (`NOT_STARTED` | `IN_PROGRESS`) and non-pending (`DONE` |
 * `REVISED`) statuses, with and without overrides, so the coverage invariant is
 * checked independently of how shares are distributed.
 *
 * fast-check assertions run a minimum of 100 iterations each.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { suggestedTimeAllocation } from './allocation';
import type { SuggestedChapterInput } from './allocation';
import type { ChapterStatus } from './frequency';

/** Pending statuses included in the allocation (Req 5.2). */
const PENDING_STATUSES: readonly ChapterStatus[] = ['NOT_STARTED', 'IN_PROGRESS'];
/** Non-pending statuses excluded from the allocation (Req 5.2). */
const NON_PENDING_STATUSES: readonly ChapterStatus[] = ['DONE', 'REVISED'];

const statusArb: fc.Arbitrary<ChapterStatus> = fc.constantFrom(
    ...PENDING_STATUSES,
    ...NON_PENDING_STATUSES,
);

/**
 * A single fully-formed SuggestedChapterInput with a caller-supplied unique
 * referenceKey/chapterId. Signal, weightage, and override fields are drawn from
 * a small space so the various distribution branches (signal, weightage
 * fallback, override) are all exercised while coverage is verified.
 */
function chapterInputArb(
    key: string,
    status: fc.Arbitrary<ChapterStatus>,
): fc.Arbitrary<SuggestedChapterInput> {
    return fc.record({
        chapterId: fc.constant(`ch-${key}`),
        referenceKey: fc.constant(key),
        pyqFrequency: fc.integer({ min: 0, max: 5 }),
        historicalFrequency: fc.integer({ min: 0, max: 5 }),
        hasHistoricalData: fc.boolean(),
        rawSignal: fc.double({ min: 0, max: 5, noNaN: true }),
        combinedWeightageSignal: fc.double({ min: 0, max: 1, noNaN: true }),
        status,
        weightage: fc.oneof(
            fc.constant<number | null>(null),
            fc.double({ min: 0, max: 10, noNaN: true }),
        ),
        weightageIsDefault: fc.boolean(),
        timeAllocationOverride: fc.oneof(
            fc.constant<number | null>(null),
            fc.double({ min: 0, max: 0.4, noNaN: true }),
        ),
    });
}

/** A set of Chapters (any status) with distinct referenceKeys. */
const mixedChapterSetArb: fc.Arbitrary<SuggestedChapterInput[]> = fc
    .integer({ min: 0, max: 12 })
    .chain((count) =>
        count === 0
            ? fc.constant<SuggestedChapterInput[]>([])
            : fc.tuple(
                ...Array.from({ length: count }, (_unused, index) =>
                    chapterInputArb(`k${String(index).padStart(2, '0')}`, statusArb),
                ),
            ),
    )
    .map((entries) => [...entries]);

/** A set of Chapters whose every status is non-pending (DONE | REVISED). */
const allNonPendingSetArb: fc.Arbitrary<SuggestedChapterInput[]> = fc
    .integer({ min: 1, max: 8 })
    .chain((count) =>
        fc.tuple(
            ...Array.from({ length: count }, (_unused, index) =>
                chapterInputArb(
                    `k${String(index).padStart(2, '0')}`,
                    fc.constantFrom(...NON_PENDING_STATUSES),
                ),
            ),
        ),
    )
    .map((entries) => [...entries]);

function pendingKeys(chapters: readonly SuggestedChapterInput[]): string[] {
    return chapters
        .filter((c) => PENDING_STATUSES.includes(c.status))
        .map((c) => c.referenceKey);
}

describe('suggestedTimeAllocation pending-chapter coverage (Property 8)', () => {
    // Feature: weightage-based-time-allocation, Property 8: Suggested allocation
    // covers exactly the pending Chapters once
    it('Property 8: includes exactly the pending Chapters, each once, excluding non-pending (Req 5.2, 6.4)', () => {
        fc.assert(
            fc.property(mixedChapterSetArb, (chapters) => {
                const result = suggestedTimeAllocation(chapters);
                const resultKeys = result.map((r) => r.referenceKey);
                const expectedPending = pendingKeys(chapters);

                // Same set of referenceKeys as the pending Chapters (no more, no less).
                expect(new Set(resultKeys)).toEqual(new Set(expectedPending));

                // Exactly once each: result length equals the pending count and has
                // no duplicate referenceKeys.
                expect(result).toHaveLength(expectedPending.length);
                expect(new Set(resultKeys).size).toBe(resultKeys.length);

                // Every non-pending Chapter is excluded from the output.
                const nonPending = chapters
                    .filter((c) => !PENDING_STATUSES.includes(c.status))
                    .map((c) => c.referenceKey);
                for (const key of nonPending) {
                    expect(resultKeys).not.toContain(key);
                }
            }),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 8: Suggested allocation
    // covers exactly the pending Chapters once
    it('Property 8: a set with no pending Chapters yields an empty allocation (Req 5.5)', () => {
        fc.assert(
            fc.property(allNonPendingSetArb, (chapters) => {
                expect(suggestedTimeAllocation(chapters)).toEqual([]);
            }),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 8: Suggested allocation
    // covers exactly the pending Chapters once
    it('Property 8: an empty Chapter set yields an empty allocation (Req 5.5)', () => {
        expect(suggestedTimeAllocation([])).toEqual([]);
    });
});
