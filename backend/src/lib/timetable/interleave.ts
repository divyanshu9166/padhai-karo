/**
 * STEP 8 of the timetable-generation pipeline — subject interleaving / anti-block
 * scheduling (Req 17.1, 17.2, 17.3, 17.4).
 *
 * Pure, framework- and database-free logic. Given the per-subject study blocks produced by
 * the energy-slotting step (STEP 7), this module produces a deterministic ORDERING that
 * interleaves subjects so that no single subject occupies more than 2 consecutive hours
 * without an intervening block of a different subject (Req 17.1). For JEE the rotation is
 * Physics / Mathematics / Chemistry; for NEET it is Biology / Physics / Chemistry
 * (Req 17.2 / 17.3).
 *
 * "2 consecutive hours" is defined as a half-open bound on summed same-subject minutes:
 *   - a run of {@link MAX_CONSECUTIVE_SUBJECT_MINUTES} (= 120) minutes is ALLOWED (≤ 120);
 *   - a run that would total MORE than 120 minutes is DISALLOWED (> 120).
 * A "run" is a maximal stretch of consecutive blocks sharing the same `subjectId`; any block
 * of a different subject resets the running total — it is the "intervening block" of Req 17.1.
 *
 * Exception (Req 17.4): when only ONE subject has pending blocks, the interleaving constraint
 * is skipped entirely and that subject's blocks are returned in their original order (it is
 * allowed to run long).
 *
 * The module exposes:
 *   - {@link maxConsecutiveSubjectMinutes} / {@link violatesInterleaving} — checkers that
 *     Property 16 (task 6.17) and the orchestrator (task 6.5) can use to assert the bound.
 *   - {@link interleaveBlocks} — the arranger that reorders per-subject blocks into a single
 *     interleaved sequence honoring the bound.
 */

/**
 * The maximum number of consecutive same-subject minutes allowed before a different-subject
 * block must intervene (Req 17.1). A run EQUAL to 120 minutes is allowed; a run exceeding it
 * is a violation.
 */
export const MAX_CONSECUTIVE_SUBJECT_MINUTES = 120;

/** Exam track, mirroring the Prisma `ExamTrack` enum (Req 17.2 / 17.3). */
export const ExamTrack = {
    JEE: 'JEE',
    NEET: 'NEET',
} as const;

export type ExamTrack = (typeof ExamTrack)[keyof typeof ExamTrack];

/**
 * Canonical JEE subject rotation order (Req 17.2). These are subject NAMES; callers map them
 * to their own `subjectId`s when supplying {@link InterleaveOptions.subjectPriority}.
 */
export const JEE_INTERLEAVE_SUBJECTS = ['Physics', 'Mathematics', 'Chemistry'] as const;

/** Canonical NEET subject rotation order (Req 17.3). See {@link JEE_INTERLEAVE_SUBJECTS}. */
export const NEET_INTERLEAVE_SUBJECTS = ['Biology', 'Physics', 'Chemistry'] as const;

/** The canonical subject rotation order for a track (Req 17.2 / 17.3). */
export function interleaveSubjectsForTrack(track: ExamTrack): readonly string[] {
    return track === ExamTrack.NEET ? NEET_INTERLEAVE_SUBJECTS : JEE_INTERLEAVE_SUBJECTS;
}

/**
 * The minimal shape of a scheduled study block the interleaver consumes: the subject it
 * belongs to and how long it runs. Richer fields on the real `StudyBlock` (start time,
 * chapter, energy level, …) are carried through untouched because {@link interleaveBlocks}
 * is generic over `T extends InterleaveUnit` and only reorders — it never mutates units.
 */
export interface InterleaveUnit {
    /** The subject the block belongs to. Buffer slots (no subject) are not interleaved here. */
    subjectId: string;
    /** The block's duration in minutes; must be a non-negative finite number. */
    durationMinutes: number;
}

/** Options for {@link interleaveBlocks}. */
export interface InterleaveOptions {
    /**
     * Desired rotation priority as a list of `subjectId`s (e.g. obtained by mapping
     * {@link interleaveSubjectsForTrack} names to ids). Subjects present in the input but
     * absent from this list are appended in order of first appearance. Used only as a
     * deterministic tie-breaker when two subjects have equal remaining work.
     */
    subjectPriority?: readonly string[];
    /** Override the consecutive-minutes bound (defaults to {@link MAX_CONSECUTIVE_SUBJECT_MINUTES}). */
    maxConsecutiveMinutes?: number;
}

/** Count the distinct subjects appearing in a sequence. */
export function distinctSubjectCount(sequence: ReadonlyArray<InterleaveUnit>): number {
    const seen = new Set<string>();
    for (const unit of sequence) {
        seen.add(unit.subjectId);
    }
    return seen.size;
}

/**
 * The longest run of consecutive same-subject minutes in `sequence`. A block of a different
 * subject resets the running total (it is an "intervening block", Req 17.1). Returns 0 for an
 * empty sequence.
 */
export function maxConsecutiveSubjectMinutes(sequence: ReadonlyArray<InterleaveUnit>): number {
    let max = 0;
    let runMinutes = 0;
    let runSubject: string | null = null;

    for (const unit of sequence) {
        if (unit.subjectId === runSubject) {
            runMinutes += unit.durationMinutes;
        } else {
            runSubject = unit.subjectId;
            runMinutes = unit.durationMinutes;
        }
        if (runMinutes > max) {
            max = runMinutes;
        }
    }
    return max;
}

/**
 * Whether `sequence` violates the interleaving bound (Req 17.1). A sequence with one or fewer
 * distinct subjects NEVER violates the constraint — the single-subject exception (Req 17.4)
 * allows it to run long. Otherwise a violation occurs when some subject runs for MORE than
 * `maxConsecutiveMinutes` consecutive minutes without an intervening different-subject block.
 */
export function violatesInterleaving(
    sequence: ReadonlyArray<InterleaveUnit>,
    maxConsecutiveMinutes: number = MAX_CONSECUTIVE_SUBJECT_MINUTES,
): boolean {
    if (distinctSubjectCount(sequence) <= 1) {
        return false; // Req 17.4: single subject is exempt.
    }
    return maxConsecutiveSubjectMinutes(sequence) > maxConsecutiveMinutes;
}

/**
 * Build a stable priority index for every subject: subjects listed in `subjectPriority` keep
 * their position; any remaining subject is appended in order of first appearance in `units`.
 */
function buildPriorityIndex(
    units: ReadonlyArray<InterleaveUnit>,
    subjectPriority: readonly string[],
): Map<string, number> {
    const index = new Map<string, number>();
    subjectPriority.forEach((subjectId) => {
        if (!index.has(subjectId)) {
            index.set(subjectId, index.size);
        }
    });
    for (const unit of units) {
        if (!index.has(unit.subjectId)) {
            index.set(unit.subjectId, index.size);
        }
    }
    return index;
}

/**
 * Interleave per-subject study blocks into a single ordered sequence honoring the
 * consecutive-hours bound (Req 17.1, STEP 8).
 *
 * Behaviour:
 *   - Blocks keep their relative order WITHIN a subject (a stable per-subject FIFO).
 *   - When only one subject has blocks, the input order is returned unchanged (Req 17.4).
 *   - Otherwise the arranger greedily emits the subject with the most remaining minutes
 *     (a "most-work-first" heuristic that prevents any subject from piling up at the end),
 *     except that it will NOT continue the current subject when doing so would push the
 *     current run past the bound while a different subject still has work — it inserts the
 *     next-priority different subject instead (Req 17.1). Ties are broken deterministically
 *     by `subjectPriority` (Req 17.2 / 17.3), then by `subjectId`, so the output is stable.
 *
 * Guarantee: when at least two subjects have remaining blocks, no subject's run exceeds the
 * bound. Once every other subject is exhausted, the lone remaining subject's blocks are
 * emitted back-to-back (there is no different subject left to intervene); this tail mirrors
 * the single-subject exception and is the only way the bound can be exceeded. The arranger
 * also cannot split an individual block, so a single unit longer than the bound is emitted
 * intact — callers should size blocks at or below the bound.
 *
 * The returned array is a new array of the SAME unit references; inputs are never mutated.
 */
export function interleaveBlocks<T extends InterleaveUnit>(
    units: ReadonlyArray<T>,
    options: InterleaveOptions = {},
): T[] {
    const maxConsecutive = options.maxConsecutiveMinutes ?? MAX_CONSECUTIVE_SUBJECT_MINUTES;
    const subjectPriority = options.subjectPriority ?? [];

    if (units.length === 0) {
        return [];
    }

    // Stable per-subject FIFO queues preserving input order within each subject.
    const queues = new Map<string, T[]>();
    for (const unit of units) {
        const queue = queues.get(unit.subjectId);
        if (queue) {
            queue.push(unit);
        } else {
            queues.set(unit.subjectId, [unit]);
        }
    }

    // Req 17.4: only one subject has pending blocks → no interleaving constraint.
    if (queues.size <= 1) {
        return [...units];
    }

    const priorityIndex = buildPriorityIndex(units, subjectPriority);

    const remainingMinutes = new Map<string, number>();
    for (const [subjectId, queue] of queues) {
        remainingMinutes.set(
            subjectId,
            queue.reduce((sum, unit) => sum + unit.durationMinutes, 0),
        );
    }

    const result: T[] = [];
    let currentSubject: string | null = null;
    let currentRunMinutes = 0;
    let remainingUnits = units.length;

    while (remainingUnits > 0) {
        const candidates: string[] = [];
        for (const [subjectId, queue] of queues) {
            if (queue.length > 0) {
                candidates.push(subjectId);
            }
        }

        // Forbid continuing the current subject when its next block would breach the bound,
        // so a different subject is forced in (Req 17.1).
        let forbidden: string | null = null;
        if (currentSubject !== null) {
            const currentQueue = queues.get(currentSubject);
            if (currentQueue && currentQueue.length > 0) {
                const nextDuration = currentQueue[0].durationMinutes;
                if (currentRunMinutes + nextDuration > maxConsecutive) {
                    forbidden = currentSubject;
                }
            }
        }

        let pool: string[] = candidates.filter((subjectId) => subjectId !== forbidden);
        if (pool.length === 0) {
            // Only the forbidden subject has work left — emitting it is unavoidable.
            pool = candidates;
        }

        // Most remaining minutes first; tie-break by rotation priority, then subjectId.
        pool.sort((a: string, b: string) => {
            const remainingDelta = remainingMinutes.get(b)! - remainingMinutes.get(a)!;
            if (remainingDelta !== 0) {
                return remainingDelta;
            }
            const priorityDelta = priorityIndex.get(a)! - priorityIndex.get(b)!;
            if (priorityDelta !== 0) {
                return priorityDelta;
            }
            return a < b ? -1 : a > b ? 1 : 0;
        });

        const chosen: string = pool[0];
        const chosenQueue = queues.get(chosen)!;
        const unit = chosenQueue.shift()!;
        result.push(unit);
        remainingMinutes.set(chosen, remainingMinutes.get(chosen)! - unit.durationMinutes);

        if (chosen === currentSubject) {
            currentRunMinutes += unit.durationMinutes;
        } else {
            currentSubject = chosen;
            currentRunMinutes = unit.durationMinutes;
        }
        remainingUnits -= 1;
    }

    return result;
}
