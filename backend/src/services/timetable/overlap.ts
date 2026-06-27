/**
 * Pure, database-free overlap logic for block edits (task 6.6; design "Edit Validation"
 * Req 3.4–3.7).
 *
 * On a `PATCH /api/timetable/blocks/:id` the orchestrator computes the PROPOSED interval for
 * the edited block and must reject the WHOLE edit (409, leaving the original unchanged) if
 * that interval overlaps ANY other study block in the same timetable OR any of the user's
 * fixed commitments (Req 3.5); otherwise it persists (Req 3.4/3.6). All of that overlap
 * reasoning lives here as small total functions so it can be unit-tested without a database
 * and reused by the property test (Property 9, task 6.10).
 *
 * Two kinds of comparison are needed because the two operands live in different time frames:
 *
 *   1. Block vs. block — both are CONCRETE `StudyBlock`s with absolute wall-clock
 *      `startTime`s and a `durationMin`. They are compared as absolute half-open epoch-ms
 *      intervals `[start, start + durationMin*60000)`.
 *
 *   2. Block vs. fixed commitment — a `FixedCommitment` is a WEEKLY RECURRING busy window
 *      identified by `dayOfWeek` (0=Sun…6=Sat) and "HH:mm" local start/end, NOT a concrete
 *      date. To compare, the proposed block is mapped to a (weekday, minute-of-day window)
 *      and tested only against commitments recurring on that same weekday.
 *
 * Time-of-day mapping (documented decision): a persisted `StudyBlock.startTime` is built by
 * the generation pipeline as `UTC-midnight-of-the-date + startMinute*60000`, where
 * `startMinute` is minutes since midnight in the grid's frame (see `./materialize` and
 * `@/lib/timetable/grid`). This module mirrors that exactly: the block's weekday is
 * `startTime.getUTCDay()` and its minute-of-day is `(startTime - UTC-midnight)/60000`. The
 * block is assumed to lie within a single UTC day, which holds for every generated block
 * because the schedulable waking window is 06:00–23:00 (so a block can never cross midnight).
 * Commitment "HH:mm" strings are parsed to minutes-since-midnight with the same parser the
 * grid uses, keeping both operands in one consistent frame.
 */
import { parseHHmm } from '@/services/onboarding/validation';

/** Milliseconds in one minute. */
const MS_PER_MINUTE = 60 * 1000;

/** Milliseconds in one UTC day. */
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** The minimal shape of a concrete study block this module reasons about. */
export interface BlockInterval {
    /** Absolute wall-clock start of the block. */
    startTime: Date;
    /** Block duration in minutes; expected to be a positive integer. */
    durationMin: number;
}

/** The minimal shape of a recurring weekly fixed commitment this module reasons about. */
export interface RecurringCommitment {
    /** Day of week the commitment recurs on, 0 (Sunday) – 6 (Saturday). */
    dayOfWeek: number;
    /** Local start time, "HH:mm". */
    startTime: string;
    /** Local end time, "HH:mm"; expected to be later than `startTime`. */
    endTime: string;
}

/** A proposed block's mapping onto a weekday and minute-of-day window. */
export interface WeekdayWindow {
    /** UTC day of week, 0 (Sunday) – 6 (Saturday). */
    dayOfWeek: number;
    /** Inclusive start, minutes since UTC midnight. */
    startMinute: number;
    /** Exclusive end, minutes since UTC midnight. */
    endMinute: number;
}

/**
 * The canonical half-open overlap predicate (design "Edit Validation"):
 * two intervals overlap IFF `startA < endB AND startB < endA`.
 *
 * Half-open semantics mean intervals that merely TOUCH at a boundary (e.g. one ends exactly
 * when the next begins) do NOT overlap. Pure and total over all numeric inputs.
 */
export function intervalsOverlap(
    startA: number,
    endA: number,
    startB: number,
    endB: number,
): boolean {
    return startA < endB && startB < endA;
}

/** Map a concrete block to its absolute half-open epoch-ms interval `[start, end)`. */
export function blockToEpochInterval(block: BlockInterval): { start: number; end: number } {
    const start = block.startTime.getTime();
    return { start, end: start + block.durationMin * MS_PER_MINUTE };
}

/**
 * Do two concrete study blocks overlap in absolute time? Both are compared as half-open
 * epoch-ms intervals, so back-to-back blocks (one ending exactly when the next starts) do
 * not conflict (Req 3.3/3.5).
 */
export function blocksConflict(a: BlockInterval, b: BlockInterval): boolean {
    const ia = blockToEpochInterval(a);
    const ib = blockToEpochInterval(b);
    return intervalsOverlap(ia.start, ia.end, ib.start, ib.end);
}

/**
 * Map a concrete block to its (UTC weekday, minute-of-day window) for comparison against
 * weekly-recurring commitments. See the module header for the framing rationale.
 */
export function blockToWeekdayWindow(block: BlockInterval): WeekdayWindow {
    const ms = block.startTime.getTime();
    const utcMidnight = Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
    const startMinute = (ms - utcMidnight) / MS_PER_MINUTE;
    return {
        dayOfWeek: block.startTime.getUTCDay(),
        startMinute,
        endMinute: startMinute + block.durationMin,
    };
}

/**
 * Does a proposed block overlap a single weekly fixed commitment? Returns `false` when the
 * commitment recurs on a different weekday than the block, or when either commitment bound
 * is not a well-formed "HH:mm" value (a malformed commitment cannot define a busy window).
 * On the same weekday the block's minute-of-day window is tested against the commitment's
 * window with the half-open {@link intervalsOverlap} predicate.
 */
export function blockConflictsWithCommitment(
    block: BlockInterval,
    commitment: RecurringCommitment,
): boolean {
    const window = blockToWeekdayWindow(block);
    if (window.dayOfWeek !== commitment.dayOfWeek) {
        return false;
    }
    const commitmentStart = parseHHmm(commitment.startTime);
    const commitmentEnd = parseHHmm(commitment.endTime);
    if (commitmentStart === null || commitmentEnd === null) {
        return false;
    }
    return intervalsOverlap(
        window.startMinute,
        window.endMinute,
        commitmentStart,
        commitmentEnd,
    );
}

/**
 * The atomic accept/reject test behind a block edit (Req 3.5/3.6): does the `proposed`
 * interval overlap ANY of the `otherBlocks` (every study block in the same timetable EXCEPT
 * the one being edited) OR ANY of the user's `commitments`?
 *
 * Returns `true` if a conflict exists (the edit must be rejected wholesale with 409) and
 * `false` when the proposed interval is clear (the edit may be persisted). Pure: callers are
 * responsible for excluding the edited block itself from `otherBlocks` and for scoping both
 * collections to the authenticated user.
 */
export function proposedBlockConflicts(
    proposed: BlockInterval,
    otherBlocks: ReadonlyArray<BlockInterval>,
    commitments: ReadonlyArray<RecurringCommitment>,
): boolean {
    for (const other of otherBlocks) {
        if (blocksConflict(proposed, other)) {
            return true;
        }
    }
    for (const commitment of commitments) {
        if (blockConflictsWithCommitment(proposed, commitment)) {
            return true;
        }
    }
    return false;
}
