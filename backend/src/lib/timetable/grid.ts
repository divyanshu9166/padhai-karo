/**
 * STEP 1 of the timetable-generation pipeline — compute the available free-time grid
 * (Req 3.1).
 *
 * Pure, database-free logic: given a per-day waking window and the user's recurring
 * `FixedCommitment`s, subtract every commitment from each weekday's window to yield the set
 * of FREE intervals per day. Slot granularity is 30 minutes, so free intervals are snapped
 * INWARD to 30-minute boundaries — start rounded up, end rounded down — which guarantees:
 *
 *   1. every free interval is 30-min aligned (a `StudyBlock` is one or more whole slots), and
 *   2. no free interval ever overlaps a `FixedCommitment` (snapping only shrinks intervals).
 *
 * The week is always represented as all seven days (0 = Sunday … 6 = Saturday); a day with
 * no free time (e.g. a commitment spanning the whole waking window) yields an empty interval
 * list rather than being omitted.
 */
import { parseHHmm } from '@/services/onboarding/validation';

import {
    DAYS_OF_WEEK,
    MINUTES_PER_DAY,
    SLOT_MINUTES,
    type DayFreeIntervals,
    type DayOfWeek,
    type FreeTimeGrid,
    type GridCommitment,
    type MinuteInterval,
    type WakingWindow,
} from './types';

/**
 * Default per-day waking window used when the caller does not supply the user's waking
 * hours: 06:00–23:00 local. Both bounds are 30-min aligned.
 */
export const DEFAULT_WAKING_WINDOW: WakingWindow = { start: '06:00', end: '23:00' };

/** Largest multiple of {@link SLOT_MINUTES} that is `<= minute` (round a slot end down). */
function floorToSlot(minute: number): number {
    return Math.floor(minute / SLOT_MINUTES) * SLOT_MINUTES;
}

/** Smallest multiple of {@link SLOT_MINUTES} that is `>= minute` (round a slot start up). */
function ceilToSlot(minute: number): number {
    return Math.ceil(minute / SLOT_MINUTES) * SLOT_MINUTES;
}

/** Parse an "HH:mm" string to minutes-since-midnight, throwing on a malformed value. */
function requireMinute(value: string, role: string): number {
    const minute = parseHHmm(value);
    if (minute === null) {
        throw new Error(`Invalid ${role} time "${value}": expected "HH:mm".`);
    }
    return minute;
}

/**
 * Resolve the waking window to a half-open minute interval, validating that end is strictly
 * after start. The bounds are NOT snapped here; callers pass a 30-min-aligned window
 * ({@link DEFAULT_WAKING_WINDOW} is aligned), and snapping happens per free interval.
 */
function resolveWindow(window: WakingWindow): MinuteInterval {
    const startMinute = requireMinute(window.start, 'waking window start');
    const endMinute = requireMinute(window.end, 'waking window end');
    if (endMinute <= startMinute) {
        throw new Error(
            `Waking window end (${window.end}) must be later than its start (${window.start}).`,
        );
    }
    return { startMinute, endMinute };
}

/**
 * Merge a list of (possibly overlapping/adjacent/unsorted) minute intervals into a minimal
 * ascending set of non-overlapping intervals.
 */
function mergeIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
    if (intervals.length === 0) {
        return [];
    }
    const sorted = [...intervals].sort((a, b) => a.startMinute - b.startMinute);
    const merged: MinuteInterval[] = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i += 1) {
        const current = sorted[i];
        const last = merged[merged.length - 1];
        if (current.startMinute <= last.endMinute) {
            // Overlapping or touching: extend the last interval.
            last.endMinute = Math.max(last.endMinute, current.endMinute);
        } else {
            merged.push({ ...current });
        }
    }
    return merged;
}

/**
 * Subtract a set of (merged) busy intervals from a window, returning the gaps as free
 * intervals. Both inputs are in minutes-since-midnight; the result is not yet slot-aligned.
 */
function subtractBusyFromWindow(
    window: MinuteInterval,
    busy: MinuteInterval[],
): MinuteInterval[] {
    const free: MinuteInterval[] = [];
    let cursor = window.startMinute;
    for (const block of busy) {
        const blockStart = Math.max(block.startMinute, window.startMinute);
        const blockEnd = Math.min(block.endMinute, window.endMinute);
        if (blockEnd <= cursor) {
            // Entirely before the cursor (or outside the window): nothing to carve.
            continue;
        }
        if (blockStart > cursor) {
            free.push({ startMinute: cursor, endMinute: blockStart });
        }
        cursor = Math.max(cursor, blockEnd);
    }
    if (cursor < window.endMinute) {
        free.push({ startMinute: cursor, endMinute: window.endMinute });
    }
    return free;
}

/**
 * Snap a free interval inward to 30-minute boundaries (start up, end down) and keep it only
 * if at least one whole slot remains. Snapping inward can never extend an interval into a
 * commitment, so the no-overlap guarantee holds.
 */
function snapToSlots(interval: MinuteInterval): MinuteInterval | null {
    const startMinute = ceilToSlot(interval.startMinute);
    const endMinute = floorToSlot(interval.endMinute);
    if (endMinute - startMinute >= SLOT_MINUTES) {
        return { startMinute, endMinute };
    }
    return null;
}

/**
 * Compute the free intervals for one weekday by subtracting that day's commitments from the
 * waking window and snapping the gaps to 30-minute slots.
 */
function computeDayFreeIntervals(
    dayOfWeek: DayOfWeek,
    window: MinuteInterval,
    commitments: GridCommitment[],
): MinuteInterval[] {
    const busy = commitments.map<MinuteInterval>((commitment) => {
        const startMinute = requireMinute(commitment.startTime, 'commitment start');
        const endMinute = requireMinute(commitment.endTime, 'commitment end');
        return { startMinute, endMinute };
    });
    const mergedBusy = mergeIntervals(busy);
    const rawFree = subtractBusyFromWindow(window, mergedBusy);
    const slots: MinuteInterval[] = [];
    for (const interval of rawFree) {
        const snapped = snapToSlots(interval);
        if (snapped) {
            slots.push(snapped);
        }
    }
    return slots;
}

/**
 * Compute the weekly free-time grid (Req 3.1, pipeline STEP 1).
 *
 * For each of the seven weekdays, subtract every `FixedCommitment` recurring on that day
 * from the waking window, yielding 30-min-aligned free intervals that never overlap a
 * commitment. Commitments for days other than the one being computed are ignored;
 * commitments with an out-of-range `dayOfWeek` are skipped.
 *
 * @param commitments  The user's recurring fixed commitments (any order, any subset of days).
 * @param wakingWindow The per-day schedulable window; defaults to {@link DEFAULT_WAKING_WINDOW}.
 * @returns A seven-element grid ordered by day of week (0 = Sunday … 6 = Saturday).
 */
export function computeFreeTimeGrid(
    commitments: ReadonlyArray<GridCommitment>,
    wakingWindow: WakingWindow = DEFAULT_WAKING_WINDOW,
): FreeTimeGrid {
    const window = resolveWindow(wakingWindow);
    return DAYS_OF_WEEK.map<DayFreeIntervals>((dayOfWeek) => {
        const dayCommitments = commitments.filter(
            (commitment) => commitment.dayOfWeek === dayOfWeek,
        );
        return {
            dayOfWeek,
            intervals: computeDayFreeIntervals(dayOfWeek, window, dayCommitments),
        };
    });
}

/**
 * Expand a single day's free intervals into the list of 30-minute slot start minutes it
 * contains. Useful for later pipeline steps that place tasks slot-by-slot. The total number
 * of slots equals the day's free minutes divided by {@link SLOT_MINUTES}.
 */
export function expandDayToSlotStarts(day: DayFreeIntervals): number[] {
    const starts: number[] = [];
    for (const interval of day.intervals) {
        for (let m = interval.startMinute; m + SLOT_MINUTES <= interval.endMinute; m += SLOT_MINUTES) {
            starts.push(m);
        }
    }
    return starts;
}

/** Total free minutes available in a single day across all its free intervals. */
export function freeMinutesInDay(day: DayFreeIntervals): number {
    return day.intervals.reduce(
        (total, interval) => total + (interval.endMinute - interval.startMinute),
        0,
    );
}

/** Total free minutes available across the whole weekly grid. */
export function freeMinutesInGrid(grid: FreeTimeGrid): number {
    return grid.reduce((total, day) => total + freeMinutesInDay(day), 0);
}

export { MINUTES_PER_DAY };
