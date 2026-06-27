/**
 * Pure timetable-basis selection (task 7.1; design "timetableBasis.ts — mapping
 * the suggestion into Phase 1 generation"; Req 7.1, 7.2, 7.3, 7.5, 7.6, 7.7).
 *
 * This is the final pure module of the Weightage-Based Time Allocation feature.
 * It decides which per-Chapter weightage basis the Phase 1 allocator
 * (`src/lib/timetable/allocation.ts → allocateStudyHours`) consumes for a given
 * timetable generation: the freshly computed Suggested_Time_Allocation (carried
 * forward in a per-user `SuggestedAllocationSnapshot`) or the untouched Phase 1
 * `Chapter_Weightage`-driven distribution.
 *
 * Following the established Phase 1 / Performance Analytics layering convention
 * (see `frequency.ts`, `signal.ts`, `src/lib/timetable/allocation.ts`), this
 * module:
 *   - imports no Prisma client and no framework code (database- and
 *     framework-free),
 *   - accepts already-read plain allocator inputs assembled by the service layer
 *     and the snapshot shares loaded from `SuggestedAllocationSnapshot`,
 *   - never mutates its inputs: it returns a fresh array of fresh objects and in
 *     particular never rewrites the *persisted* `Chapter.weightage` — it only
 *     rewrites the *in-memory* allocator input (Req 7.5),
 *   - reads defensively so that malformed or empty inputs never throw,
 *   - is part of the property-test surface (task 7.2 — Property 11).
 *
 * ── Basis selection (Req 7.1, 7.2, 7.3, 7.6, 7.7) ─────────────────────────────
 * When `mode === 'SUGGESTED'` and the snapshot covers at least one currently
 * pending Chapter (Req 7.1), each pending Chapter (`NOT_STARTED | IN_PROGRESS`,
 * Req 7.3) that appears in the snapshot has its in-memory `weightage` set to its
 * snapshot Allocation_Share; Chapters absent from the snapshot keep their Phase 1
 * `weightage`. In every other case — `PHASE1_DEFAULT` (Req 7.2), an unset/`null`
 * mode (Req 7.6), or a `SUGGESTED` mode whose snapshot includes no pending
 * Chapter (Req 7.7) — the Phase 1 `weightage` is returned unchanged for every
 * Chapter. Non-pending Chapters are never rewritten, mirroring the allocator's
 * own pending filter (Req 7.3); they are still copied through so the caller hands
 * an unchanged, but fresh, list to `allocateStudyHours`.
 */

import type { ChapterStatus } from './frequency';

/**
 * The User-selectable Effective_Allocation_Mode (mirrors the additive Prisma
 * `EffectiveAllocationMode` enum). `'SUGGESTED'` uses the most recent
 * Suggested_Time_Allocation as the basis (Req 7.1); `'PHASE1_DEFAULT'` uses the
 * Phase 1 `Chapter_Weightage`-driven distribution (Req 7.2). A `null` mode means
 * the User has not set a preference and is treated as the Phase 1 default
 * (Req 7.6).
 */
export type EffectiveAllocationMode = 'SUGGESTED' | 'PHASE1_DEFAULT';

/**
 * The minimal per-Chapter shape {@link resolveTimetableBasis} operates on — a
 * structural subset of the Phase 1 `AllocatorChapter` (`src/lib/timetable`). The
 * function is generic over this shape so the caller's richer allocator objects
 * (carrying `subjectId`, `estimatedStudyHours`, override fields, …) pass straight
 * through with only `weightage` possibly rewritten.
 */
export interface AllocatorChapterLike {
    /** Stable Chapter identifier; the key matched against the snapshot shares. */
    id: string;
    /** Chapter lifecycle status; only pending Chapters can be rewritten (Req 7.3). */
    status: ChapterStatus;
    /**
     * Reference (effective Phase 1) `Chapter_Weightage`. `null`/`undefined` means
     * a missing reference weightage, left untouched here for the Phase 1 allocator
     * to resolve via its own subject-mean fallback.
     */
    weightage?: number | null;
}

/**
 * The pending statuses eligible to take a suggested share (Req 7.3), mirroring
 * the Phase 1 allocator's pending filter. A Chapter is rewritten only while it is
 * `NOT_STARTED` or `IN_PROGRESS`.
 */
const PENDING_STATUSES: ReadonlySet<ChapterStatus> = new Set<ChapterStatus>([
    'NOT_STARTED',
    'IN_PROGRESS',
]);

/** True when a Chapter status is pending (schedulable / rewritable), per Req 7.3. */
function isPendingStatus(status: unknown): boolean {
    return typeof status === 'string' && PENDING_STATUSES.has(status as ChapterStatus);
}

/**
 * Defensively coerce a possibly-malformed `ReadonlyMap` input into a usable map.
 * Returns an empty map for any non-Map input so callers never throw on malformed
 * data.
 */
function safeShares(
    shares: ReadonlyMap<string, number> | null | undefined,
): ReadonlyMap<string, number> {
    return shares instanceof Map ? shares : new Map<string, number>();
}

/**
 * Look up a finite, usable snapshot share for a Chapter, or `undefined` when the
 * Chapter is absent from the snapshot or its stored share is not a finite number
 * (defensive — such a Chapter then keeps its Phase 1 weightage, Req 7.1).
 */
function snapshotShareFor(
    chapterId: string,
    shares: ReadonlyMap<string, number>,
): number | undefined {
    const share = shares.get(chapterId);
    return typeof share === 'number' && Number.isFinite(share) ? share : undefined;
}

/**
 * Decide the per-Chapter weightage basis the Phase 1 allocator consumes for one
 * timetable generation (Req 7.1, 7.2, 7.3, 7.5, 7.6, 7.7).
 *
 * When `mode === 'SUGGESTED'` and the snapshot covers at least one currently
 * pending Chapter, each pending Chapter present in the snapshot has its in-memory
 * `weightage` rewritten to its snapshot Allocation_Share; every other Chapter
 * (non-pending, or pending but absent from the snapshot) keeps its Phase 1
 * `weightage`. Otherwise — `PHASE1_DEFAULT`, an unset/`null` mode, or a snapshot
 * with no pending Chapter — every Chapter's Phase 1 `weightage` is returned
 * unchanged.
 *
 * Pure and mutation-safe: it reads its inputs only and returns a fresh array of
 * fresh, shallow-copied objects. It never writes the persisted `Chapter.weightage`
 * (Req 7.5) — only the returned in-memory copies are ever adjusted. An empty
 * `chapters` input yields an empty result.
 *
 * @typeParam T The caller's allocator-chapter shape (at least {@link AllocatorChapterLike}).
 * @param chapters The pending+all allocator chapters with their Phase 1 weightage.
 * @param mode The User's Effective_Allocation_Mode, or `null` when unset (Req 7.6).
 * @param snapshotShares Map of `chapterId` -> snapshot Allocation_Share, from the
 *   most recent `SuggestedAllocationSnapshot`.
 * @returns A fresh array of fresh chapter objects with `weightage` adjusted only
 *   where the suggestion applies.
 */
export function resolveTimetableBasis<T extends AllocatorChapterLike>(
    chapters: readonly T[],
    mode: EffectiveAllocationMode | null,
    snapshotShares: ReadonlyMap<string, number>,
): T[] {
    const safeChapters = Array.isArray(chapters) ? chapters : [];
    const shares = safeShares(snapshotShares);

    // Apply the suggestion only when the User chose SUGGESTED *and* the snapshot
    // covers at least one currently pending Chapter (Req 7.1, 7.7). When it covers
    // none, the basis is the unchanged Phase 1 weightage (Req 7.7); a PHASE1_DEFAULT
    // or unset/null mode never applies it (Req 7.2, 7.6).
    const applySuggestion =
        mode === 'SUGGESTED' &&
        safeChapters.some(
            (chapter) =>
                isPendingStatus(chapter?.status) &&
                snapshotShareFor(chapter?.id, shares) !== undefined,
        );

    return safeChapters.map((chapter) => {
        if (applySuggestion && isPendingStatus(chapter?.status)) {
            const share = snapshotShareFor(chapter?.id, shares);
            if (share !== undefined) {
                // Rewrite only the in-memory copy's weightage (Req 7.1, 7.5).
                return { ...chapter, weightage: share };
            }
        }
        // Phase 1 weightage unchanged — but still a fresh object (Req 7.2, 7.5, 7.6).
        return { ...chapter };
    });
}
