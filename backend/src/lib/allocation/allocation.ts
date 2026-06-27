/**
 * Pure Suggested_Time_Allocation computation (task 6.1; design "Components and
 * Interfaces → Pure layer → `allocation.ts`"; Req 5.1–5.5, 6.1–6.5, 8.1, 8.5,
 * 8.6, 8.7).
 *
 * This module turns the per-Chapter {@link ChapterSignal}s produced by
 * `signal.ts` into the Suggested_Time_Allocation — a normalized per-Chapter
 * share of total study time across the User's *pending* Chapters. The resulting
 * shares are later mapped onto the Phase 1 allocator's per-Chapter weightage
 * basis (`timetableBasis.ts`) so the existing timetable generator reuses them
 * untouched.
 *
 * Following the established Phase 1 / Performance Analytics layering convention
 * (see `src/lib/allocation/signal.ts`, `src/lib/allocation/ranking.ts`,
 * `src/services/analytics/topicPriority.ts`, `src/lib/timetable/allocation.ts`),
 * this module:
 *   - imports no Prisma client and no framework code (database- and
 *     framework-free),
 *   - accepts already-computed plain inputs and never mutates them (it reads the
 *     inputs and builds a fresh array of fresh objects),
 *   - reads defensively so malformed or empty inputs never throw,
 *   - is the property-test surface for suggested-allocation behavior
 *     (tasks 6.2–6.5, Properties 7–10).
 *
 * ── Algorithm (Req 5, 6, 8) ──────────────────────────────────────────────────
 * Only pending Chapters (`NOT_STARTED` | `IN_PROGRESS`) participate; each
 * appears exactly once (Req 5.2, 6.4). An empty pending set yields `[]` (Req 5.5).
 *
 *  1. **Overrides first (Req 8.1, 8.5).** A Chapter carrying a
 *     `timeAllocationOverride` keeps that stored share verbatim, labeled
 *     `USER_OVERRIDE`; the value is never reduced or discarded.
 *  2. **Remaining share.** `R = clamp(1 - Σoverrides, 0, 1)` is distributed
 *     across the non-overridden Chapters in proportion to a per-Chapter *basis*.
 *     If `Σoverrides >= 1` then `R = 0` and every non-overridden Chapter gets `0`
 *     (Req 8.6). If every pending Chapter is overridden there is nothing to
 *     distribute (Req 8.7).
 *  3. **Basis selection.** Among the non-overridden Chapters:
 *       - if *every* combined signal is zero, the whole group falls back to
 *         Phase 1 `Chapter_Weightage` proportions (Req 5.4), labeled
 *         `WEIGHTAGE_FALLBACK`;
 *       - otherwise a Chapter with data (positive PYQ frequency or a historical
 *         record) is distributed by its `combinedWeightageSignal`, labeled
 *         `COMBINED_SIGNAL`, while a *data-less* Chapter (zero PYQ frequency AND
 *         no historical record) falls back to its `Chapter_Weightage`, labeled
 *         `WEIGHTAGE_FALLBACK` (Req 6.1, 6.2).
 *  4. **Retention floor (Req 6.5).** A fallback Chapter whose `Chapter_Weightage`
 *     is absent or zero would otherwise receive a zero basis; it is instead
 *     floored to the smallest positive basis in the group so it receives the
 *     smallest non-zero share and is never dropped. When no Chapter has a
 *     positive basis the share is split equally so every Chapter is retained.
 *  5. **Rounding (Req 5.3, 6.1).** Every share is rounded to 4 decimal places and
 *     the largest non-overridden share absorbs the rounding residue so the shares
 *     sum to `1.0` within `0.001`. When `Σoverrides >= 1` the override values are
 *     left intact and no residue balancing is applied (Req 8.6).
 *
 * `weightageIsDefault` is carried through unchanged for every Chapter (Req 6.3).
 */

import type { ChapterStatus } from './frequency';
import type { ChapterSignal } from './signal';

/**
 * The per-Chapter input consumed by {@link suggestedTimeAllocation}: a
 * {@link ChapterSignal} augmented with the Chapter's status, its effective
 * Phase 1 weightage (Weightage_Override already applied by the reader, Req 8.2),
 * the `weightageIsDefault` flag, and an optional User Time_Allocation_Override.
 */
export interface SuggestedChapterInput extends ChapterSignal {
    /** The Chapter's progress state; only pending Chapters are allocated (Req 5.2). */
    status: ChapterStatus;
    /** Effective Phase 1 `Chapter_Weightage` (Weightage_Override already applied). */
    weightage: number | null;
    /** Phase 1 `weightageIsDefault` flag, preserved into the output (Req 6.3). */
    weightageIsDefault: boolean;
    /** A User Time_Allocation_Override share for this Chapter, if any (Req 8.1, 8.5). */
    timeAllocationOverride?: number | null;
}

/** The origin of a Chapter's {@link ChapterAllocationShare} (Req 6.2, 8.1). */
export type AllocationSource =
    | 'COMBINED_SIGNAL'
    | 'WEIGHTAGE_FALLBACK'
    | 'USER_OVERRIDE';

/** One Chapter's resulting Suggested_Time_Allocation entry. */
export interface ChapterAllocationShare {
    chapterId: string;
    referenceKey: string;
    /** The Chapter's Allocation_Share in `[0, 1]`, rounded to 4 dp (Req 5.3). */
    allocationShare: number;
    /** How the share was derived (Req 6.2, 8.1). */
    source: AllocationSource;
    /** Preserved from the input (Req 6.3). */
    weightageIsDefault: boolean;
}

/** The Chapter statuses considered pending for allocation (Req 5.2). */
const PENDING_STATUSES: ReadonlySet<ChapterStatus> = new Set<ChapterStatus>([
    'NOT_STARTED',
    'IN_PROGRESS',
]);

/** Number of decimal places each Allocation_Share is rounded to (Req 5.3). */
const SHARE_DECIMALS = 4;
const SHARE_SCALE = 10 ** SHARE_DECIMALS;

/** Round a value to {@link SHARE_DECIMALS} decimal places. */
function roundShare(value: number): number {
    return Math.round(value * SHARE_SCALE) / SHARE_SCALE;
}

/** Clamp a value into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

/**
 * A finite, non-negative Time_Allocation_Override marks a Chapter as overridden
 * (Req 8.1). Any other value (null, undefined, NaN, negative) is treated as "no
 * override" so the Chapter participates in the signal-based distribution.
 */
function isOverride(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A finite, positive effective weightage, else `0` (Req 6.5 absent/zero handling). */
function safeWeightage(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : 0;
}

/** A finite, non-negative combined signal, else `0` (defensive). */
function safeSignal(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : 0;
}

/**
 * A Chapter is *data-less* when it has no PYQ practice (`pyqFrequency` is zero)
 * AND no historical record (`hasHistoricalData` is false) — the condition that
 * triggers the per-Chapter `Chapter_Weightage` fallback (Req 6.1).
 */
function isDataLess(chapter: SuggestedChapterInput): boolean {
    const pyq =
        typeof chapter.pyqFrequency === 'number' &&
            Number.isFinite(chapter.pyqFrequency)
            ? chapter.pyqFrequency
            : 0;
    return pyq <= 0 && chapter.hasHistoricalData !== true;
}

/**
 * Compute the Suggested_Time_Allocation across the User's pending Chapters
 * (Req 5, 6, 8).
 *
 * Returns one {@link ChapterAllocationShare} per pending Chapter, in the order
 * the pending Chapters appear in `inputs`. Non-pending Chapters are excluded
 * (Req 5.2) and an input with no pending Chapter yields `[]` (Req 5.5). See the
 * module header for the full override → signal → weightage-fallback algorithm.
 *
 * Pure: performs no I/O, reads `inputs` only, and returns a fresh array of fresh
 * objects — neither `inputs` nor any element is mutated.
 *
 * @param inputs The per-Chapter signals, statuses, weightages, and overrides.
 */
export function suggestedTimeAllocation(
    inputs: readonly SuggestedChapterInput[],
): ChapterAllocationShare[] {
    const safeInputs = Array.isArray(inputs) ? inputs : [];
    const pending = safeInputs.filter(
        (chapter): chapter is SuggestedChapterInput =>
            chapter != null && PENDING_STATUSES.has(chapter.status),
    );
    if (pending.length === 0) {
        return [];
    }

    // Step 1: partition into overridden and non-overridden pending Chapters.
    const sumOverrides = pending.reduce(
        (sum, chapter) =>
            isOverride(chapter.timeAllocationOverride)
                ? sum + chapter.timeAllocationOverride
                : sum,
        0,
    );
    const remaining = clamp(1 - sumOverrides, 0, 1);

    // Resolve the share + source for every non-overridden Chapter by chapterId.
    const nonOverridden = pending.filter(
        (chapter) => !isOverride(chapter.timeAllocationOverride),
    );
    const distributed = new Map<string, { share: number; source: AllocationSource }>();

    if (nonOverridden.length > 0) {
        // Step 2: when no share remains (overrides total >= 1), every
        // non-overridden Chapter receives zero and no override is reduced (Req 8.6).
        if (remaining <= 0) {
            const allSignalsZero =
                nonOverridden.reduce(
                    (sum, chapter) => sum + safeSignal(chapter.combinedWeightageSignal),
                    0,
                ) <= 0;
            for (const chapter of nonOverridden) {
                distributed.set(chapter.chapterId, {
                    share: 0,
                    source:
                        allSignalsZero || isDataLess(chapter)
                            ? 'WEIGHTAGE_FALLBACK'
                            : 'COMBINED_SIGNAL',
                });
            }
        } else {
            // Step 3: choose a per-Chapter basis and source.
            const sumSignal = nonOverridden.reduce(
                (sum, chapter) => sum + safeSignal(chapter.combinedWeightageSignal),
                0,
            );
            const allSignalsZero = sumSignal <= 0;

            const bases = nonOverridden.map((chapter) => {
                // Global weightage fallback (Req 5.4) or per-Chapter data-less
                // fallback (Req 6.1) both distribute by Chapter_Weightage.
                if (allSignalsZero || isDataLess(chapter)) {
                    return {
                        chapter,
                        basis: safeWeightage(chapter.weightage),
                        source: 'WEIGHTAGE_FALLBACK' as AllocationSource,
                    };
                }
                return {
                    chapter,
                    basis: safeSignal(chapter.combinedWeightageSignal),
                    source: 'COMBINED_SIGNAL' as AllocationSource,
                };
            });

            // Step 4: retention floor (Req 6.5). A fallback Chapter with an
            // absent/zero weightage (basis 0) is floored to the smallest positive
            // basis so it earns the smallest non-zero share and is never dropped.
            // When nothing has a positive basis, weight every Chapter equally.
            const positiveBases = bases
                .map((entry) => entry.basis)
                .filter((basis) => basis > 0);
            const minPositiveBasis =
                positiveBases.length > 0 ? Math.min(...positiveBases) : 0;
            for (const entry of bases) {
                if (entry.basis <= 0) {
                    entry.basis = minPositiveBasis > 0 ? minPositiveBasis : 1;
                }
            }

            const totalBasis = bases.reduce((sum, entry) => sum + entry.basis, 0);
            for (const entry of bases) {
                const share =
                    totalBasis > 0 ? (entry.basis / totalBasis) * remaining : 0;
                distributed.set(entry.chapter.chapterId, {
                    share,
                    source: entry.source,
                });
            }
        }
    }

    // Assemble the (still unrounded) result in pending input order, exactly once
    // per pending Chapter (Req 6.4).
    const result: ChapterAllocationShare[] = pending.map((chapter) => {
        if (isOverride(chapter.timeAllocationOverride)) {
            return {
                chapterId: chapter.chapterId,
                referenceKey: chapter.referenceKey,
                allocationShare: chapter.timeAllocationOverride,
                source: 'USER_OVERRIDE',
                weightageIsDefault: chapter.weightageIsDefault === true,
            };
        }
        const entry = distributed.get(chapter.chapterId);
        return {
            chapterId: chapter.chapterId,
            referenceKey: chapter.referenceKey,
            allocationShare: entry ? entry.share : 0,
            source: entry ? entry.source : 'COMBINED_SIGNAL',
            weightageIsDefault: chapter.weightageIsDefault === true,
        };
    });

    // Step 5: round to 4 dp; the largest non-overridden share absorbs the
    // residue so the shares sum to 1.0 within 0.001 (Req 5.3, 6.1). When overrides
    // total >= 1 the values are left intact and no balancing occurs (Req 8.6).
    for (const share of result) {
        share.allocationShare = roundShare(share.allocationShare);
    }

    const canBalance = nonOverridden.length > 0 && remaining > 0;
    if (canBalance) {
        const roundedSum = result.reduce(
            (sum, share) => sum + share.allocationShare,
            0,
        );
        const residue = roundShare(1 - roundedSum);
        if (residue !== 0) {
            let target: ChapterAllocationShare | undefined;
            for (const share of result) {
                if (share.source === 'USER_OVERRIDE') {
                    continue;
                }
                if (target === undefined || share.allocationShare > target.allocationShare) {
                    target = share;
                }
            }
            if (target !== undefined) {
                target.allocationShare = roundShare(target.allocationShare + residue);
            }
        }
    }

    return result;
}
