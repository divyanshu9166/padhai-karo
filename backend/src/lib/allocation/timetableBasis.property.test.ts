/**
 * Property-based test for pure timetable-basis selection (task 7.2).
 *
 *   - Property 11 (task 7.2): Timetable basis selection honors mode and snapshot
 *     (Req 7.1, 7.2, 7.3, 7.5, 7.6, 7.7).
 *
 * `resolveTimetableBasis(chapters, mode, snapshotShares)` decides which per-Chapter
 * weightage basis the Phase 1 allocator consumes:
 *   - When `mode === 'SUGGESTED'` and the snapshot covers at least one currently
 *     pending Chapter (`NOT_STARTED | IN_PROGRESS`), each pending Chapter present in
 *     the snapshot has its in-memory `weightage` rewritten to its snapshot
 *     Allocation_Share; Chapters that are non-pending, or pending but absent from the
 *     snapshot, keep their Phase 1 `weightage` (Req 7.1, 7.3).
 *   - Otherwise — `PHASE1_DEFAULT` (Req 7.2), an unset/`null` mode (Req 7.6), or a
 *     `SUGGESTED` snapshot covering no pending Chapter (Req 7.7) — every Chapter's
 *     Phase 1 `weightage` is returned unchanged.
 *   - In all cases the inputs are never mutated; the persisted/input `weightage`
 *     values are returned unchanged (Req 7.5).
 *
 * fast-check assertions, each running a minimum of 100 iterations.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ChapterStatus } from './frequency';
import {
    resolveTimetableBasis,
    type AllocatorChapterLike,
    type EffectiveAllocationMode,
} from './timetableBasis';

const PENDING: readonly ChapterStatus[] = ['NOT_STARTED', 'IN_PROGRESS'];
const NON_PENDING: readonly ChapterStatus[] = ['DONE', 'REVISED'];
const ALL_STATUSES: readonly ChapterStatus[] = [...PENDING, ...NON_PENDING];

const isPending = (status: ChapterStatus): boolean =>
    status === 'NOT_STARTED' || status === 'IN_PROGRESS';

/** A reference Phase 1 weightage: a finite non-negative number, or null/absent. */
const weightage = (): fc.Arbitrary<number | null> =>
    fc.oneof(
        fc.double({ min: 0, max: 1_000, noNaN: true, noDefaultInfinity: true }),
        fc.constant(null),
    );

/** A finite snapshot Allocation_Share in [0, 1]. */
const share = (): fc.Arbitrary<number> =>
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** A set of allocator chapters with unique ids and arbitrary statuses/weightages. */
const chaptersArb = (
    statuses: readonly ChapterStatus[] = ALL_STATUSES,
): fc.Arbitrary<AllocatorChapterLike[]> =>
    fc
        .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
            minLength: 0,
            maxLength: 8,
        })
        .chain((ids) =>
            fc.tuple(
                ...ids.map((id) =>
                    fc.record({
                        id: fc.constant(id),
                        status: fc.constantFrom(...statuses),
                        weightage: weightage(),
                    }),
                ),
            ),
        ) as fc.Arbitrary<AllocatorChapterLike[]>;

/**
 * Build a snapshot share map over a (possibly empty) subset of the given chapter
 * ids, optionally plus extraneous ids absent from the chapter list.
 */
function sharesArb(
    chapters: readonly AllocatorChapterLike[],
): fc.Arbitrary<ReadonlyMap<string, number>> {
    const ids = chapters.map((c) => c.id);
    return fc
        .tuple(
            fc.subarray(ids),
            fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 4 }),
        )
        .chain(([subset, extras]) => {
            const keys = [...new Set([...subset, ...extras])];
            return fc
                .tuple(...keys.map(() => share()))
                .map((vals) => {
                    const map = new Map<string, number>();
                    keys.forEach((k, i) => map.set(k, vals[i] ?? 0));
                    return map as ReadonlyMap<string, number>;
                });
        });
}

/** Deep snapshot of inputs for mutation detection. */
function snapshotInputs(
    chapters: readonly AllocatorChapterLike[],
    shares: ReadonlyMap<string, number>,
) {
    return {
        chapters: chapters.map((c) => ({ ...c })),
        shares: [...shares.entries()],
    };
}

describe('Timetable basis selection honors mode and snapshot', () => {
    // Feature: weightage-based-time-allocation, Property 11: Timetable basis selection
    // honors mode and snapshot.
    it('Property 11: SUGGESTED with >=1 pending snapshot Chapter rewrites only pending Chapters present in the snapshot (Req 7.1, 7.3)', () => {
        fc.assert(
            fc.property(
                chaptersArb().chain((chapters) =>
                    sharesArb(chapters).map((shares) => ({ chapters, shares })),
                ),
                ({ chapters, shares }) => {
                    const result = resolveTimetableBasis(chapters, 'SUGGESTED', shares);

                    const applies = chapters.some(
                        (c) => isPending(c.status) && shares.has(c.id),
                    );

                    expect(result).toHaveLength(chapters.length);
                    result.forEach((out, i) => {
                        const input = chapters[i];
                        expect(out.id).toBe(input.id);
                        expect(out.status).toBe(input.status);

                        if (applies && isPending(input.status) && shares.has(input.id)) {
                            // Pending + present in snapshot -> weightage equals the share.
                            expect(out.weightage).toBe(shares.get(input.id));
                        } else {
                            // Non-pending, pending-but-absent, or no applicable snapshot
                            // -> Phase 1 weightage unchanged.
                            expect(out.weightage).toBe(input.weightage);
                        }
                    });
                },
            ),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 11: Timetable basis selection
    // honors mode and snapshot.
    it('Property 11: SUGGESTED with a snapshot covering no pending Chapter leaves weightage unchanged (Req 7.7)', () => {
        fc.assert(
            fc.property(
                // Chapters whose snapshot keys reference only NON-pending chapters.
                chaptersArb().chain((chapters) => {
                    const nonPendingIds = chapters
                        .filter((c) => !isPending(c.status))
                        .map((c) => c.id);
                    return fc
                        .tuple(...nonPendingIds.map(() => share()))
                        .map((vals) => {
                            const map = new Map<string, number>();
                            nonPendingIds.forEach((id, i) => map.set(id, vals[i] ?? 0));
                            return { chapters, shares: map as ReadonlyMap<string, number> };
                        });
                }),
                ({ chapters, shares }) => {
                    const result = resolveTimetableBasis(chapters, 'SUGGESTED', shares);
                    expect(result).toHaveLength(chapters.length);
                    result.forEach((out, i) => {
                        expect(out.weightage).toBe(chapters[i].weightage);
                    });
                },
            ),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 11: Timetable basis selection
    // honors mode and snapshot.
    it('Property 11: PHASE1_DEFAULT and unset/null mode leave every Phase 1 weightage unchanged (Req 7.2, 7.6)', () => {
        fc.assert(
            fc.property(
                chaptersArb().chain((chapters) =>
                    sharesArb(chapters).map((shares) => ({ chapters, shares })),
                ),
                fc.constantFrom<EffectiveAllocationMode | null>('PHASE1_DEFAULT', null),
                ({ chapters, shares }, mode) => {
                    const result = resolveTimetableBasis(chapters, mode, shares);
                    expect(result).toHaveLength(chapters.length);
                    result.forEach((out, i) => {
                        expect(out.id).toBe(chapters[i].id);
                        expect(out.weightage).toBe(chapters[i].weightage);
                    });
                },
            ),
            { numRuns: 200 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 11: Timetable basis selection
    // honors mode and snapshot.
    it('Property 11: inputs are never mutated regardless of mode (Req 7.5)', () => {
        fc.assert(
            fc.property(
                chaptersArb().chain((chapters) =>
                    sharesArb(chapters).map((shares) => ({ chapters, shares })),
                ),
                fc.constantFrom<EffectiveAllocationMode | null>(
                    'SUGGESTED',
                    'PHASE1_DEFAULT',
                    null,
                ),
                ({ chapters, shares }, mode) => {
                    const before = snapshotInputs(chapters, shares);
                    const result = resolveTimetableBasis(chapters, mode, shares);

                    // The result is a fresh array of fresh objects (no aliasing).
                    expect(result).not.toBe(chapters as unknown);
                    result.forEach((out, i) => {
                        expect(out).not.toBe(chapters[i]);
                    });

                    // Inputs are byte-for-byte unchanged after the call.
                    const after = snapshotInputs(chapters, shares);
                    expect(after).toEqual(before);
                },
            ),
            { numRuns: 200 },
        );
    });
});
