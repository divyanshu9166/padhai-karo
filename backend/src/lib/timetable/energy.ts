/**
 * STEPS 6–7 of the timetable-generation pipeline — difficulty/energy tagging and
 * energy-based slotting (Req 2.9, 13.1, 13.2, 13.3, 13.4).
 *
 * Pure, database-free logic. Two concerns live here:
 *
 *   STEP 6 — tag every free SLOT with an {@link EnergyLevel} (`HIGH`/`LOW`) derived from the
 *            user's `Peak_Focus_Window`s, and carry each study task's `Task_Difficulty`
 *            (`HARD`/`LIGHT`). A slot is HIGH-energy when its start minute falls within one of
 *            the user's peak windows, otherwise LOW. With NO peak windows set, every slot is
 *            LOW (Req 2.9 / 13.1).
 *
 *   STEP 7 — greedily match tagged tasks to tagged slots: HARD tasks go to HIGH-energy slots
 *            and LIGHT tasks to LOW-energy slots (Req 13.2/13.3). If no HIGH-energy slot is
 *            available for a HARD task, it spills into the NEXT AVAILABLE slot and the
 *            placement is flagged `scheduledOutsidePeak = true` (Req 13.4).
 *
 * Time-of-day is in MINUTES SINCE LOCAL MIDNIGHT (0–1440), consistent with the rest of the
 * pipeline. The matching is fully deterministic: tasks are consumed in input order and slots
 * are consumed in ascending `(day, startMinute)` order.
 */
import type { PeakFocusWindow } from '@/services/onboarding/validation';

import { MINUTES_PER_DAY, type DayOfWeek, type MinuteInterval } from './types';

/** Energy classification of a time slot (Req 13.1). */
export type EnergyLevel = 'HIGH' | 'LOW';

/** Difficulty of a study task, mirroring the Prisma `TaskDifficulty` enum (Req 13.2/13.3). */
export type TaskDifficulty = 'HARD' | 'LIGHT';

/**
 * The time-of-day band each `Peak_Focus_Window` maps to, as half-open minute intervals
 * `[startMinute, endMinute)` since local midnight. The three bands TILE the full day
 * `[0, 1440)` with no gaps and no overlaps, so every minute belongs to exactly one window:
 *
 *   - MORNING   → 05:00–12:00  `[300, 720)`
 *   - AFTERNOON → 12:00–17:00  `[720, 1020)`
 *   - NIGHT     → 17:00–24:00  `[1020, 1440)`  AND  00:00–05:00  `[0, 300)`
 *
 * NIGHT deliberately wraps past midnight (the small hours belong to "night"), which is why
 * it is the only band expressed as two intervals.
 */
export const PEAK_WINDOW_BANDS: Readonly<Record<PeakFocusWindow, readonly MinuteInterval[]>> = {
    MORNING: [{ startMinute: 5 * 60, endMinute: 12 * 60 }],
    AFTERNOON: [{ startMinute: 12 * 60, endMinute: 17 * 60 }],
    NIGHT: [
        { startMinute: 17 * 60, endMinute: MINUTES_PER_DAY },
        { startMinute: 0, endMinute: 5 * 60 },
    ],
} as const;

/** True when `minute` falls within any of the band's half-open intervals. */
function minuteInBand(minute: number, band: readonly MinuteInterval[]): boolean {
    return band.some(
        (interval) => minute >= interval.startMinute && minute < interval.endMinute,
    );
}

/**
 * Resolve which `Peak_Focus_Window` band a minute-of-day falls in. Because the bands tile
 * the whole day, this is total for any `minute` in `[0, 1440)`.
 */
export function peakWindowForMinute(minute: number): PeakFocusWindow {
    if (minuteInBand(minute, PEAK_WINDOW_BANDS.MORNING)) {
        return 'MORNING';
    }
    if (minuteInBand(minute, PEAK_WINDOW_BANDS.AFTERNOON)) {
        return 'AFTERNOON';
    }
    return 'NIGHT';
}

/**
 * Classify a single slot's energy from the user's peak windows (STEP 6, Req 13.1).
 *
 * The slot is HIGH-energy when its start minute falls within one of the marked
 * `peakWindows`, otherwise LOW. When `peakWindows` is empty, the result is always LOW —
 * every slot is low-energy for a user who set no peak windows (Req 2.9).
 *
 * @param startMinute Slot start, minutes since local midnight (0–1440).
 * @param peakWindows The user's marked peak focus windows (may be empty).
 */
export function classifySlotEnergy(
    startMinute: number,
    peakWindows: ReadonlyArray<PeakFocusWindow>,
): EnergyLevel {
    if (peakWindows.length === 0) {
        return 'LOW';
    }
    const window = peakWindowForMinute(startMinute);
    return peakWindows.includes(window) ? 'HIGH' : 'LOW';
}

/** A schedulable slot before energy classification: a weekday and a slot start minute. */
export interface SlotInput {
    day: DayOfWeek;
    /** Slot start, minutes since local midnight (0–1440). */
    startMinute: number;
}

/** A schedulable slot tagged with its {@link EnergyLevel} (output of STEP 6). */
export interface EnergySlot extends SlotInput {
    energyLevel: EnergyLevel;
}

/**
 * Tag a list of free slots with their energy level (STEP 6, Req 13.1 / 2.9). Order is
 * preserved; an empty `peakWindows` yields all-LOW slots.
 */
export function classifySlots(
    slots: ReadonlyArray<SlotInput>,
    peakWindows: ReadonlyArray<PeakFocusWindow>,
): EnergySlot[] {
    return slots.map((slot) => ({
        ...slot,
        energyLevel: classifySlotEnergy(slot.startMinute, peakWindows),
    }));
}

/**
 * A study task to be slotted. `slotCount` is how many 30-minute slots the task occupies
 * (defaults to 1 when omitted). The task carries its `Task_Difficulty` (Req 13.2/13.3).
 */
export interface StudyTask {
    id: string;
    difficulty: TaskDifficulty;
    /** Number of 30-minute slots the task needs; defaults to 1. */
    slotCount?: number;
}

/** The result of placing one task: the slots it took and its energy classification. */
export interface TaskPlacement {
    taskId: string;
    difficulty: TaskDifficulty;
    /** The slots assigned to the task, in ascending order. */
    slots: EnergySlot[];
    /**
     * The placement's overall energy level. A HARD task fully placed in HIGH-energy slots is
     * `HIGH`; a HARD task that had to spill into LOW slots is `LOW` (and flagged below). A
     * LIGHT task placed in LOW slots is `LOW`; one that spilled into HIGH slots is `HIGH`.
     */
    energyLevel: EnergyLevel;
    /**
     * True only for a HARD task that could not be placed entirely in HIGH-energy slots and
     * was scheduled outside a peak focus window (Req 13.4). Always false for LIGHT tasks.
     */
    scheduledOutsidePeak: boolean;
}

/** Output of {@link assignTasksToSlots}: the placements plus any tasks that did not fit. */
export interface SlottingResult {
    placements: TaskPlacement[];
    /** Tasks that could not be placed because too few slots remained (in input order). */
    unplacedTasks: StudyTask[];
}

/** Deterministic slot ordering: by weekday, then by start minute. */
function compareSlots(a: SlotInput, b: SlotInput): number {
    return a.day - b.day || a.startMinute - b.startMinute;
}

/**
 * Energy-based slotting (STEP 7, Req 13.2/13.3/13.4).
 *
 * Greedily places each task into slots of its matching energy: HARD → HIGH, LIGHT → LOW.
 * Slots are consumed in ascending `(day, startMinute)` order and tasks in input order, so
 * the result is deterministic. For each task, slots of the preferred energy are taken first;
 * when the preferred energy is exhausted, the task spills into the next available slot of the
 * other energy. A HARD task that takes any non-HIGH slot is flagged `scheduledOutsidePeak`
 * (Req 13.4). A task is left unplaced (never partially consuming slots) when fewer than
 * `slotCount` slots remain.
 *
 * @param tasks       The difficulty-tagged tasks to place, in priority order.
 * @param energySlots The energy-classified slots available for placement.
 */
export function assignTasksToSlots(
    tasks: ReadonlyArray<StudyTask>,
    energySlots: ReadonlyArray<EnergySlot>,
): SlottingResult {
    const ordered = [...energySlots].sort(compareSlots);
    const used = new Array<boolean>(ordered.length).fill(false);
    let remaining = ordered.length;

    /** Take the next unused slot matching `predicate`, marking it used, or null if none. */
    const take = (predicate: (slot: EnergySlot) => boolean): EnergySlot | null => {
        for (let i = 0; i < ordered.length; i += 1) {
            if (!used[i] && predicate(ordered[i])) {
                used[i] = true;
                remaining -= 1;
                return ordered[i];
            }
        }
        return null;
    };

    const placements: TaskPlacement[] = [];
    const unplacedTasks: StudyTask[] = [];

    for (const task of tasks) {
        const slotCount = task.slotCount ?? 1;
        // Don't partially consume slots: skip a task that cannot be fully placed.
        if (slotCount > remaining) {
            unplacedTasks.push(task);
            continue;
        }

        const preferred: EnergyLevel = task.difficulty === 'HARD' ? 'HIGH' : 'LOW';
        const assigned: EnergySlot[] = [];
        for (let k = 0; k < slotCount; k += 1) {
            // Prefer a matching-energy slot; otherwise take the next available slot.
            const slot =
                take((s) => s.energyLevel === preferred) ?? take(() => true);
            // `slot` is guaranteed non-null here because remaining >= slotCount was checked.
            assigned.push(slot as EnergySlot);
        }

        if (task.difficulty === 'HARD') {
            const allHigh = assigned.every((s) => s.energyLevel === 'HIGH');
            placements.push({
                taskId: task.id,
                difficulty: 'HARD',
                slots: assigned,
                energyLevel: allHigh ? 'HIGH' : 'LOW',
                scheduledOutsidePeak: !allHigh,
            });
        } else {
            const allLow = assigned.every((s) => s.energyLevel === 'LOW');
            placements.push({
                taskId: task.id,
                difficulty: 'LIGHT',
                slots: assigned,
                energyLevel: allLow ? 'LOW' : 'HIGH',
                scheduledOutsidePeak: false,
            });
        }
    }

    return { placements, unplacedTasks };
}
