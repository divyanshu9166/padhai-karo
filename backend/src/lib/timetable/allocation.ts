/**
 * STEPS 3–5 of the timetable-generation pipeline (Req 11.1, 11.2, 11.3, 11.4, 11.5, 12.3,
 * 14.5, 15.1).
 *
 * Pure, database- and framework-free logic that turns a weekly study budget `W` (hours,
 * produced by STEP 2 in `./budget`) plus the user's pending chapters into a per-chapter
 * allocation of study hours:
 *
 *   - STEP 3 — Buffer reservation (Req 15.1): reserve a fraction of `W` (target 12.5%,
 *     clamped to [10%, 15%]) as buffer; the rest is assignable time `A = W - B`.
 *   - STEP 4 — Weightage-aware chapter allocation (Req 11, 12.3): consider only pending
 *     chapters, resolve each chapter's effective weightage by override precedence (with a
 *     subject-mean fallback for missing reference weightage), then split `A` proportionally
 *     by weightage and cap each chapter by its remaining estimated hours (redistributing any
 *     capped surplus to uncapped chapters via water-filling).
 *   - STEP 5 — Efficiency auto-scaling (Req 14.5): when the user under-completes
 *     (`efficiencyScore < 1`) scale each chapter's allocation toward actual completed time.
 *
 * No rounding to 30-minute slots happens here — that is the job of the energy-slotting step
 * (task 6.3). Hours are kept as exact floating-point values so the buffer fraction and the
 * weightage proportions are preserved precisely.
 *
 * Persistence of overrides across generations (Req 11.4) is the database's responsibility
 * (overrides live on the `Chapter` row); this module only honours the override precedence on
 * whatever input it is given.
 */

/* ────────────────────────────── Buffer (STEP 3) ────────────────────────────── */

/**
 * Target buffer fraction of the weekly budget reserved as `Buffer_Slot`s (Req 15.1). The
 * design targets 12.5% — the midpoint of the permitted [10%, 15%] band.
 */
export const BUFFER_TARGET_FRACTION = 0.125;

/** Minimum permitted buffer fraction of the weekly budget (Req 15.1): 10%. */
export const BUFFER_MIN_FRACTION = 0.1;

/** Maximum permitted buffer fraction of the weekly budget (Req 15.1): 15%. */
export const BUFFER_MAX_FRACTION = 0.15;

/** Result of STEP 3 — splitting the weekly budget `W` into buffer `B` and assignable `A`. */
export interface BufferReservation {
    /** The weekly study budget `W` in hours (the input). */
    weeklyBudgetHours: number;
    /** The fraction of `W` reserved as buffer, always within [10%, 15%]. */
    bufferFraction: number;
    /** Reserved buffer hours `B = W * bufferFraction` (Req 15.1). */
    bufferHours: number;
    /** Assignable hours `A = W - B` available for chapter allocation (STEP 4). */
    assignableHours: number;
}

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/**
 * STEP 3 — reserve buffer time from the weekly budget (Req 15.1).
 *
 * Reserves `B = W * fraction` hours of buffer where `fraction` is clamped into the permitted
 * [{@link BUFFER_MIN_FRACTION}, {@link BUFFER_MAX_FRACTION}] band (default
 * {@link BUFFER_TARGET_FRACTION}). The remaining `A = W - B` is the assignable budget for
 * chapter allocation. Hours are intentionally left fractional; slot rounding happens in a
 * later pipeline step.
 *
 * @param weeklyBudgetHours The weekly study budget `W` (hours); non-positive inputs yield a
 *   zero buffer and zero assignable time.
 * @param fraction The desired buffer fraction; clamped to [10%, 15%]. Defaults to 12.5%.
 */
export function reserveBuffer(
    weeklyBudgetHours: number,
    fraction: number = BUFFER_TARGET_FRACTION,
): BufferReservation {
    const bufferFraction = clamp(fraction, BUFFER_MIN_FRACTION, BUFFER_MAX_FRACTION);
    const budget = weeklyBudgetHours > 0 ? weeklyBudgetHours : 0;
    const bufferHours = budget * bufferFraction;
    return {
        weeklyBudgetHours: budget,
        bufferFraction,
        bufferHours,
        assignableHours: budget - bufferHours,
    };
}

/* ───────────────────────── Chapter allocation (STEPS 4–5) ───────────────────────── */

/** Chapter lifecycle status, mirroring the Prisma `ChapterStatus` enum (Req 12). */
export type ChapterStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'REVISED';

/**
 * The pending statuses considered for scheduling (Req 12.3): a chapter is eligible for
 * allocation only while it is `NOT_STARTED` or `IN_PROGRESS`. `DONE`/`REVISED` chapters are
 * excluded.
 */
const PENDING_STATUSES: ReadonlySet<ChapterStatus> = new Set<ChapterStatus>([
    'NOT_STARTED',
    'IN_PROGRESS',
]);

/** True when a chapter status is pending (schedulable), per Req 12.3. */
export function isPendingStatus(status: ChapterStatus): boolean {
    return PENDING_STATUSES.has(status);
}

/**
 * The plain, database-free input shape the allocator consumes for a single chapter. This is
 * intentionally NOT the Prisma `Chapter` model — pure logic must not import Prisma — but it
 * mirrors the relevant columns.
 */
export interface AllocatorChapter {
    /** Stable identifier echoed back on the allocation result. */
    id: string;
    /** The subject this chapter belongs to (drives the subject-mean fallback, Req 11.5). */
    subjectId: string;
    /** Current lifecycle status; only pending chapters are allocated (Req 12.3). */
    status: ChapterStatus;
    /**
     * Reference `Chapter_Weightage`. `null`/`undefined` means the reference weightage is
     * MISSING, triggering the subject-mean fallback (Req 11.5).
     */
    weightage?: number | null;
    /** Per-user weightage override (Req 11.3/11.4); takes precedence over reference weightage. */
    weightageOverride?: number | null;
    /**
     * Per-user explicit time-allocation override (Req 11.3); highest-precedence weightage
     * signal — when present it is used directly as the chapter's effective weightage.
     */
    timeAllocationOverride?: number | null;
    /** Reference `Estimated_Study_Hours` used as the allocation cap (Req 12). */
    estimatedStudyHours: number;
    /** Per-user estimated-hours override; when present it replaces {@link estimatedStudyHours} as the cap. */
    estHoursOverride?: number | null;
}

/** Per-chapter allocation produced by STEPS 4–5. */
export interface ChapterAllocation {
    /** The chapter's id (echoed from input). */
    chapterId: string;
    /** The chapter's subject id (echoed from input). */
    subjectId: string;
    /** The effective weightage used for the proportional split (after override/fallback resolution). */
    effectiveWeightage: number;
    /**
     * True when the effective weightage came from the subject-mean fallback because the
     * reference weightage was missing and no override was supplied (Req 11.5).
     */
    weightageIsDefault: boolean;
    /** The cap applied to this chapter: remaining estimated hours (`estHoursOverride ?? estimatedStudyHours`). */
    remainingEstimateHours: number;
    /** Allocation after weightage split + capping but BEFORE efficiency scaling. */
    unscaledHours: number;
    /** Final allocation after capping AND efficiency scaling (Req 14.5). `<= unscaledHours`. */
    allocatedHours: number;
}

/** The full result of STEPS 3–5. */
export interface AllocationResult {
    /** Reserved buffer hours `B` (STEP 3, Req 15.1). */
    bufferHours: number;
    /** Assignable hours `A = W - B` distributed across pending chapters (STEP 4). */
    assignableHours: number;
    /** The efficiency score applied in STEP 5 (Req 14.5). */
    efficiencyScore: number;
    /** Per-chapter allocations, one entry per PENDING input chapter (Req 12.3). */
    allocations: ChapterAllocation[];
}

/** Options accepted by {@link allocateStudyHours}. */
export interface AllocationOptions {
    /**
     * The user's efficiency score (Σ actual / Σ planned, Req 14.4/14.5). When `< 1` the
     * allocation is scaled down toward actual completed time; `>= 1` leaves it unchanged.
     * Defaults to `1` (no scaling). Negative scores are treated as `0`.
     */
    efficiencyScore?: number;
    /** Desired buffer fraction; clamped to [10%, 15%]. Defaults to {@link BUFFER_TARGET_FRACTION}. */
    bufferFraction?: number;
}

/**
 * Equal-split fallback weightage used only when a chapter needs the subject-mean fallback but
 * NO chapter in its subject (nor anywhere in the input) has a defined weightage. In that
 * degenerate case every fallback chapter gets weight `1`, which reduces to an equal split.
 */
const EQUAL_FALLBACK_WEIGHTAGE = 1;

/** Tolerance for floating-point comparisons in the water-filling redistribution. */
const EPSILON = 1e-9;

/**
 * The weightage a chapter contributes to a subject mean, WITHOUT the fallback: the highest
 * available of `timeAllocationOverride`, `weightageOverride`, or reference `weightage`.
 * Returns `null` when none is defined (so the chapter itself relies on the fallback and must
 * be excluded from the mean to avoid circularity).
 */
function definedWeightage(chapter: AllocatorChapter): number | null {
    if (chapter.timeAllocationOverride != null) return chapter.timeAllocationOverride;
    if (chapter.weightageOverride != null) return chapter.weightageOverride;
    if (chapter.weightage != null) return chapter.weightage;
    return null;
}

/**
 * Compute, per subject, the mean of defined weightages across the supplied chapters, plus a
 * global mean over every chapter with a defined weightage. Used to fill missing reference
 * weightage (Req 11.5).
 */
function computeSubjectMeans(chapters: ReadonlyArray<AllocatorChapter>): {
    bySubject: Map<string, number>;
    global: number | null;
} {
    const sums = new Map<string, { total: number; count: number }>();
    let globalTotal = 0;
    let globalCount = 0;

    for (const chapter of chapters) {
        const defined = definedWeightage(chapter);
        if (defined == null) continue;
        const entry = sums.get(chapter.subjectId) ?? { total: 0, count: 0 };
        entry.total += defined;
        entry.count += 1;
        sums.set(chapter.subjectId, entry);
        globalTotal += defined;
        globalCount += 1;
    }

    const bySubject = new Map<string, number>();
    for (const [subjectId, { total, count }] of sums) {
        bySubject.set(subjectId, total / count);
    }
    return { bySubject, global: globalCount > 0 ? globalTotal / globalCount : null };
}

/** The cap for a chapter: its remaining estimated hours (`estHoursOverride ?? estimatedStudyHours`), clamped to `>= 0`. */
function remainingEstimateHours(chapter: AllocatorChapter): number {
    const raw = chapter.estHoursOverride != null ? chapter.estHoursOverride : chapter.estimatedStudyHours;
    return raw > 0 ? raw : 0;
}

/**
 * Resolve a pending chapter's effective weightage by the precedence in Req 11.3/11.5:
 *   1. `timeAllocationOverride` (Req 11.3), else
 *   2. `weightageOverride`, else
 *   3. reference `weightage`, else
 *   4. subject-mean fallback (Req 11.5) — flagged `weightageIsDefault = true`.
 *
 * The fallback uses the chapter's subject mean when available, else the global mean, else the
 * {@link EQUAL_FALLBACK_WEIGHTAGE} (degenerate equal-split case).
 */
function resolveWeightage(
    chapter: AllocatorChapter,
    means: { bySubject: Map<string, number>; global: number | null },
): { effectiveWeightage: number; weightageIsDefault: boolean } {
    const defined = definedWeightage(chapter);
    if (defined != null) {
        return { effectiveWeightage: Math.max(0, defined), weightageIsDefault: false };
    }
    const fallback =
        means.bySubject.get(chapter.subjectId) ?? means.global ?? EQUAL_FALLBACK_WEIGHTAGE;
    return { effectiveWeightage: Math.max(0, fallback), weightageIsDefault: true };
}

/**
 * Distribute `assignable` hours across the given weighted, capped chapters using
 * proportional water-filling.
 *
 * Each chapter's natural share is `assignable * weight / Σweight`. A chapter whose share
 * would exceed its cap is pinned at its cap and the freed surplus is redistributed
 * proportionally among the still-uncapped chapters; this repeats until either every chapter
 * is capped or no chapter's proportional share exceeds its cap (a single final proportional
 * pass). If every chapter is capped and surplus remains, that surplus stays unallocated (it
 * is effectively additional slack and never inflates a chapter beyond its estimate).
 */
function waterFill(
    items: ReadonlyArray<{ key: string; weight: number; cap: number }>,
    assignable: number,
): Map<string, number> {
    const alloc = new Map<string, number>();
    for (const item of items) alloc.set(item.key, 0);

    let pool = assignable > 0 ? assignable : 0;
    const uncapped = items.filter((item) => item.weight > 0 && item.cap > 0).map((item) => item.key);
    const weightOf = new Map(items.map((item) => [item.key, item.weight]));
    const capOf = new Map(items.map((item) => [item.key, item.cap]));

    while (pool > EPSILON && uncapped.length > 0) {
        const totalWeight = uncapped.reduce((sum, key) => sum + (weightOf.get(key) ?? 0), 0);
        if (totalWeight <= EPSILON) break;

        // Chapters whose proportional share this round would meet or exceed their remaining cap.
        const cappedThisRound = uncapped.filter((key) => {
            const remainingCap = (capOf.get(key) ?? 0) - (alloc.get(key) ?? 0);
            const share = (pool * (weightOf.get(key) ?? 0)) / totalWeight;
            return share >= remainingCap - EPSILON;
        });

        if (cappedThisRound.length === 0) {
            // No further capping: assign the proportional share to everyone and finish.
            for (const key of uncapped) {
                const share = (pool * (weightOf.get(key) ?? 0)) / totalWeight;
                alloc.set(key, (alloc.get(key) ?? 0) + share);
            }
            pool = 0;
            break;
        }

        // Pin each newly-capped chapter at its cap and return the surplus to the pool.
        for (const key of cappedThisRound) {
            const remainingCap = (capOf.get(key) ?? 0) - (alloc.get(key) ?? 0);
            alloc.set(key, capOf.get(key) ?? 0);
            pool -= remainingCap;
            const idx = uncapped.indexOf(key);
            if (idx >= 0) uncapped.splice(idx, 1);
        }
    }

    return alloc;
}

/**
 * STEPS 3–5 — reserve buffer, allocate assignable hours across pending chapters by effective
 * weightage (capped by remaining estimate), and apply efficiency scaling (Req 11, 12.3, 14.5,
 * 15.1).
 *
 * Only pending chapters (Req 12.3) appear in the result. Higher effective weightage yields
 * more time at equal remaining estimate (Req 11.1/11.2); this proportional split is the
 * DEFAULT distribution, not an equal split. Allocation is capped by each chapter's remaining
 * estimated hours and the capped surplus is redistributed to uncapped chapters. When
 * `efficiencyScore < 1`, every chapter's allocation is scaled by that score and therefore
 * never exceeds its unscaled allocation (Property 29).
 *
 * @param chapters All chapters (any status); non-pending ones are ignored for allocation but
 *   still contribute their defined weightage to subject means (Req 11.5).
 * @param weeklyBudgetHours The weekly study budget `W` from STEP 2.
 * @param options Efficiency score and buffer fraction.
 */
export function allocateStudyHours(
    chapters: ReadonlyArray<AllocatorChapter>,
    weeklyBudgetHours: number,
    options: AllocationOptions = {},
): AllocationResult {
    const { bufferHours, assignableHours } = reserveBuffer(weeklyBudgetHours, options.bufferFraction);

    const rawEfficiency = options.efficiencyScore ?? 1;
    const efficiencyScore = rawEfficiency < 0 ? 0 : rawEfficiency;
    // STEP 5 scale factor: only scale DOWN when under-completing; never scale up (Req 14.5).
    const scaleFactor = efficiencyScore < 1 ? efficiencyScore : 1;

    const means = computeSubjectMeans(chapters);
    const pending = chapters.filter((chapter) => isPendingStatus(chapter.status));

    const resolved = pending.map((chapter) => {
        const { effectiveWeightage, weightageIsDefault } = resolveWeightage(chapter, means);
        return {
            chapter,
            effectiveWeightage,
            weightageIsDefault,
            cap: remainingEstimateHours(chapter),
        };
    });

    const capped = waterFill(
        resolved.map((entry) => ({
            key: entry.chapter.id,
            weight: entry.effectiveWeightage,
            cap: entry.cap,
        })),
        assignableHours,
    );

    const allocations: ChapterAllocation[] = resolved.map((entry) => {
        const unscaledHours = capped.get(entry.chapter.id) ?? 0;
        return {
            chapterId: entry.chapter.id,
            subjectId: entry.chapter.subjectId,
            effectiveWeightage: entry.effectiveWeightage,
            weightageIsDefault: entry.weightageIsDefault,
            remainingEstimateHours: entry.cap,
            unscaledHours,
            allocatedHours: unscaledHours * scaleFactor,
        };
    });

    return { bufferHours, assignableHours, efficiencyScore, allocations };
}
