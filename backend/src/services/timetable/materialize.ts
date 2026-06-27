/**
 * STEP 9 of the timetable-generation pipeline — materialize the abstract allocation/slotting
 * result into concrete, persistable `StudyBlock`s with real wall-clock start times
 * (task 6.5; design "Timetable Generation" STEP 9; Req 3.1, 3.2, 3.3).
 *
 * This module is the PURE, database-free heart of generation. Given:
 *   - the week's dates and per-day reshaped loads (STEP 2 output, to know which dates are
 *     excluded by a `MOCK_TEST`),
 *   - the free-time grid (STEP 1 output, the only schedulable minutes — never overlapping a
 *     `FixedCommitment`, Req 3.1),
 *   - the user's peak focus windows (for energy tagging, STEP 6),
 *   - the per-chapter hour allocation (STEPS 3–5 output) plus each chapter's task difficulty,
 *   - the reserved buffer hours and the assignable hours, and
 *   - the track's subject rotation priority (STEP 8 interleaving tie-break),
 *
 * it produces a set of concrete {@link MaterializedBlock}s — study blocks bound to real
 * `startTime`s within the week plus `Buffer_Slot`s — with three guarantees that hold BY
 * CONSTRUCTION (and are re-asserted by {@link assertNoOverlap}):
 *
 *   1. No two produced blocks overlap in time (Req 3.3): every block is built from one or
 *      more DISTINCT 30-minute slots of the free grid; each slot is consumed at most once.
 *   2. No block overlaps a `FixedCommitment` (Req 3.1): blocks only ever occupy free-grid
 *      slots, which the grid step already carved clear of every commitment.
 *   3. Study blocks are distributed across every subject that has a positive allocation
 *      (Req 3.2): one study task is emitted per allocated chapter and placed while capacity
 *      remains.
 *
 * Buffer reservation is kept proportional to the study time actually scheduled so the
 * persisted buffer stays within the design's 10–15% band even when chapter allocations are
 * capped or the free grid is the binding constraint (Req 15.1): `bufferSlots ≈ studySlots *
 * (bufferHours / assignableHours)`, which equals `bufferHours / W` of the total.
 *
 * Time-of-day is in MINUTES SINCE LOCAL MIDNIGHT (0–1440) inside the grid; a concrete
 * `startTime` is the slot's UTC-midnight date plus that minute offset, consistent with the
 * rest of the pipeline (`./budget`, dashboard, audits).
 */
import {
    assignTasksToSlots,
    classifySlotEnergy,
    type EnergyLevel,
    type EnergySlot,
    type StudyTask,
    type TaskDifficulty,
} from '@/lib/timetable/energy';
import { expandDayToSlotStarts } from '@/lib/timetable/grid';
import { interleaveBlocks, type InterleaveUnit } from '@/lib/timetable/interleave';
import {
    SLOT_MINUTES,
    type DayLoad,
    type DayOfWeek,
    type FreeTimeGrid,
} from '@/lib/timetable/types';
import type { PeakFocusWindow } from '@/services/onboarding/validation';

/** Hours represented by a single 30-minute scheduling slot. */
export const SLOT_HOURS = SLOT_MINUTES / 60;

const MS_PER_MINUTE = 60 * 1000;

/** A single pending chapter's allocation, ready to be expanded into a study task (STEP 9). */
export interface MaterializeChapter {
    chapterId: string;
    subjectId: string;
    /** Allocated study hours from STEPS 3–5 (after capping + efficiency scaling). */
    allocatedHours: number;
    /** The chapter's `Task_Difficulty`, carried through to energy slotting (Req 13.2/13.3). */
    taskDifficulty: TaskDifficulty;
}

/** All inputs the materializer needs to produce concrete blocks. */
export interface MaterializeInput {
    /** The seven UTC-midnight dates of the target week (e.g. {@link weekDatesFromStart}). */
    weekDates: ReadonlyArray<Date>;
    /** The reshaped per-day loads (STEP 2); used only to skip `excluded` (Mock_Test) dates. */
    perDayLoads: ReadonlyArray<DayLoad>;
    /** The free-time grid (STEP 1): the only schedulable minutes (Req 3.1). */
    freeGrid: FreeTimeGrid;
    /** The user's marked peak focus windows (may be empty → all slots LOW, Req 2.9). */
    peakWindows: ReadonlyArray<PeakFocusWindow>;
    /** Per-chapter hour allocations (STEPS 3–5) with difficulty. */
    allocations: ReadonlyArray<MaterializeChapter>;
    /** Reserved buffer hours `B` (STEP 3, Req 15.1). */
    bufferHours: number;
    /** Assignable hours `A = W - B` (STEP 3); drives the buffer-to-study ratio. */
    assignableHours: number;
    /** Subject rotation priority as `subjectId`s (STEP 8 tie-break, Req 17.2/17.3). */
    subjectPriority: ReadonlyArray<string>;
}

/**
 * A concrete, persistable study/buffer block. Mirrors the schedulable columns of the Prisma
 * `StudyBlock` model; the orchestrator stamps `timetableId`/`userId` at persistence time.
 */
export interface MaterializedBlock {
    /** The block's subject, or `null` for a `Buffer_Slot` (Req 15.1). */
    subjectId: string | null;
    /** The block's chapter, or `null` for a buffer slot. */
    chapterId: string | null;
    /** Concrete wall-clock start of the block. */
    startTime: Date;
    /** Block duration in minutes; always a positive multiple of {@link SLOT_MINUTES}. */
    durationMin: number;
    /** True for a reserved `Buffer_Slot` (Req 15.1). */
    isBuffer: boolean;
    /** The block's overall energy classification (Req 13.1). */
    energyLevel: EnergyLevel;
    /** True for a HARD task that could not be placed entirely in a peak window (Req 13.4). */
    scheduledOutsidePeak: boolean;
}

/** The materialized timetable: study blocks plus reserved buffer slots, each `startTime`-ordered. */
export interface MaterializeResult {
    studyBlocks: MaterializedBlock[];
    bufferSlots: MaterializedBlock[];
}

/** A concrete free slot bound to a real date/time, tagged with its energy level. */
interface ConcreteSlot {
    dayOfWeek: DayOfWeek;
    startMinute: number;
    startTime: Date;
    energyLevel: EnergyLevel;
}

/** A study task enriched with the chapter/subject it represents (carried through slotting). */
interface ChapterTask extends InterleaveUnit {
    chapterId: string;
    subjectId: string;
    difficulty: TaskDifficulty;
    slotCount: number;
    durationMinutes: number;
}

/** Stable key uniquely identifying a slot within a single week (`dayOfWeek` is unique there). */
function slotKey(dayOfWeek: number, startMinute: number): string {
    return `${dayOfWeek}:${startMinute}`;
}

/**
 * Expand the free grid into concrete, energy-tagged slots for the schedulable dates of the
 * week, in chronological order. Dates flagged `excluded` (a `MOCK_TEST`, Req 16.5) contribute
 * no slots. Because the seven week dates carry seven distinct days-of-week, the
 * `(dayOfWeek, startMinute)` pair uniquely identifies each slot.
 */
export function buildConcreteSlots(
    weekDates: ReadonlyArray<Date>,
    perDayLoads: ReadonlyArray<DayLoad>,
    freeGrid: FreeTimeGrid,
    peakWindows: ReadonlyArray<PeakFocusWindow>,
): ConcreteSlot[] {
    const excludedDays = new Set<number>();
    for (const load of perDayLoads) {
        if (load.excluded) {
            excludedDays.add(load.date.getTime());
        }
    }

    const slots: ConcreteSlot[] = [];
    for (const date of weekDates) {
        if (excludedDays.has(date.getTime())) {
            continue;
        }
        const dayOfWeek = date.getUTCDay() as DayOfWeek;
        const dayGrid = freeGrid.find((day) => day.dayOfWeek === dayOfWeek);
        if (!dayGrid) {
            continue;
        }
        for (const startMinute of expandDayToSlotStarts(dayGrid)) {
            slots.push({
                dayOfWeek,
                startMinute,
                startTime: new Date(date.getTime() + startMinute * MS_PER_MINUTE),
                energyLevel: classifySlotEnergy(startMinute, peakWindows),
            });
        }
    }

    slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    return slots;
}

/** Build one study task per chapter whose allocation rounds to at least one slot. */
function buildTasks(allocations: ReadonlyArray<MaterializeChapter>): ChapterTask[] {
    const tasks: ChapterTask[] = [];
    for (const allocation of allocations) {
        const slotCount = Math.round(allocation.allocatedHours / SLOT_HOURS);
        if (slotCount < 1) {
            continue;
        }
        tasks.push({
            chapterId: allocation.chapterId,
            subjectId: allocation.subjectId,
            difficulty: allocation.taskDifficulty,
            slotCount,
            durationMinutes: slotCount * SLOT_MINUTES,
        });
    }
    return tasks;
}

/**
 * Split the available capacity between study slots and buffer slots, keeping buffer
 * proportional to the study time actually scheduled (Req 15.1). Returns how many leading
 * concrete slots form the study pool and how many of the slots that follow are reserved as
 * buffer.
 */
export function splitStudyAndBuffer(
    studyDemandSlots: number,
    capacity: number,
    bufferHours: number,
    assignableHours: number,
): { studySlots: number; bufferSlots: number } {
    if (capacity <= 0 || studyDemandSlots <= 0) {
        return { studySlots: 0, bufferSlots: 0 };
    }

    // Buffer hours per assignable hour → buffer slots per study slot. Falls back to 0 when
    // there is no assignable time (degenerate budget).
    const ratio = assignableHours > 0 ? bufferHours / assignableHours : 0;

    if (studyDemandSlots * (1 + ratio) <= capacity) {
        const studySlots = studyDemandSlots;
        // Keep buffer + study within capacity even after rounding.
        const bufferSlots = Math.min(Math.round(studySlots * ratio), capacity - studySlots);
        return { studySlots, bufferSlots: Math.max(0, bufferSlots) };
    }

    // The free grid is the binding constraint: fill it, preserving the buffer fraction.
    const bufferSlots = Math.round((capacity * ratio) / (1 + ratio));
    return { studySlots: capacity - bufferSlots, bufferSlots };
}

/** Group `startTime`-sorted slots into maximal runs of contiguous (touching) 30-min slots. */
function groupContiguous(slots: ConcreteSlot[]): ConcreteSlot[][] {
    const sorted = [...slots].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const runs: ConcreteSlot[][] = [];
    for (const slot of sorted) {
        const current = runs[runs.length - 1];
        const last = current?.[current.length - 1];
        if (
            last &&
            slot.startTime.getTime() === last.startTime.getTime() + SLOT_MINUTES * MS_PER_MINUTE
        ) {
            current.push(slot);
        } else {
            runs.push([slot]);
        }
    }
    return runs;
}

/** Collapse a contiguous run of slots into one block with the given subject/chapter metadata. */
function runToBlock(
    run: ConcreteSlot[],
    options: {
        subjectId: string | null;
        chapterId: string | null;
        isBuffer: boolean;
        difficulty: TaskDifficulty | null;
    },
): MaterializedBlock {
    const allHigh = run.every((slot) => slot.energyLevel === 'HIGH');
    const energyLevel: EnergyLevel = allHigh ? 'HIGH' : 'LOW';
    return {
        subjectId: options.subjectId,
        chapterId: options.chapterId,
        startTime: run[0].startTime,
        durationMin: run.length * SLOT_MINUTES,
        isBuffer: options.isBuffer,
        energyLevel,
        // A HARD task occupying any non-HIGH slot was scheduled outside its peak window (Req 13.4).
        scheduledOutsidePeak: options.difficulty === 'HARD' && !allHigh,
    };
}

/**
 * Materialize the allocation/slotting result into concrete blocks (STEP 9, Req 3.1/3.2/3.3,
 * 13, 15.1, 17).
 *
 * Pipeline within this step:
 *   1. Expand the free grid into chronologically ordered, energy-tagged concrete slots
 *      (skipping `MOCK_TEST` dates).
 *   2. Build one study task per allocated chapter and interleave them so subjects rotate
 *      (STEP 8 ordering, Req 17).
 *   3. Reserve a study pool (the leading slots) and a proportional buffer pool (the slots
 *      that follow), guaranteeing the two pools are disjoint.
 *   4. Energy-slot the interleaved tasks into the study pool (HARD→HIGH, LIGHT→LOW; spill +
 *      flag when no matching-energy slot remains, Req 13.4).
 *   5. Collapse each task's assigned slots into contiguous blocks; collapse the buffer pool
 *      into buffer blocks (`subjectId`/`chapterId` null, Req 15.1).
 *
 * Inputs are never mutated. The result's two block lists are each `startTime`-ordered.
 */
export function materializeTimetable(input: MaterializeInput): MaterializeResult {
    const concreteSlots = buildConcreteSlots(
        input.weekDates,
        input.perDayLoads,
        input.freeGrid,
        input.peakWindows,
    );
    const capacity = concreteSlots.length;

    const tasks = buildTasks(input.allocations);
    const studyDemandSlots = tasks.reduce((sum, task) => sum + task.slotCount, 0);

    const { studySlots, bufferSlots } = splitStudyAndBuffer(
        studyDemandSlots,
        capacity,
        input.bufferHours,
        input.assignableHours,
    );

    const studyPool = concreteSlots.slice(0, studySlots);
    const bufferPool = concreteSlots.slice(studySlots, studySlots + bufferSlots);

    // STEP 8: interleave so no subject runs long; priority is a deterministic tie-break.
    const interleaved = interleaveBlocks(tasks, { subjectPriority: [...input.subjectPriority] });
    const taskMeta = new Map(
        interleaved.map((task) => [task.chapterId, task] as const),
    );

    // STEPS 6–7: energy-tag the study-pool slots and greedily place tasks.
    const energySlots: EnergySlot[] = studyPool.map((slot) => ({
        day: slot.dayOfWeek,
        startMinute: slot.startMinute,
        energyLevel: slot.energyLevel,
    }));
    const concreteByKey = new Map(
        studyPool.map((slot) => [slotKey(slot.dayOfWeek, slot.startMinute), slot] as const),
    );
    const studyTasks: StudyTask[] = interleaved.map((task) => ({
        id: task.chapterId,
        difficulty: task.difficulty,
        slotCount: task.slotCount,
    }));

    const { placements } = assignTasksToSlots(studyTasks, energySlots);

    const studyBlocks: MaterializedBlock[] = [];
    for (const placement of placements) {
        const meta = taskMeta.get(placement.taskId);
        if (!meta) {
            continue;
        }
        const concrete = placement.slots
            .map((slot) => concreteByKey.get(slotKey(slot.day, slot.startMinute)))
            .filter((slot): slot is ConcreteSlot => slot !== undefined);
        for (const run of groupContiguous(concrete)) {
            studyBlocks.push(
                runToBlock(run, {
                    subjectId: meta.subjectId,
                    chapterId: meta.chapterId,
                    isBuffer: false,
                    difficulty: meta.difficulty,
                }),
            );
        }
    }

    const bufferBlocks: MaterializedBlock[] = groupContiguous(bufferPool).map((run) =>
        runToBlock(run, {
            subjectId: null,
            chapterId: null,
            isBuffer: true,
            difficulty: null,
        }),
    );

    const byStart = (a: MaterializedBlock, b: MaterializedBlock): number =>
        a.startTime.getTime() - b.startTime.getTime();
    studyBlocks.sort(byStart);
    bufferBlocks.sort(byStart);

    return { studyBlocks, bufferSlots: bufferBlocks };
}

/**
 * Assert the no-overlap invariant across a set of materialized blocks (Req 3.3): sorted by
 * start, each block must end at or before the next one begins. Throws on any overlap so the
 * orchestrator can refuse to persist a malformed timetable. Returns the blocks unchanged
 * (sorted) on success.
 */
export function assertNoOverlap(blocks: ReadonlyArray<MaterializedBlock>): MaterializedBlock[] {
    const sorted = [...blocks].sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );
    for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        const previousEnd = previous.startTime.getTime() + previous.durationMin * MS_PER_MINUTE;
        if (current.startTime.getTime() < previousEnd) {
            throw new Error(
                `Overlapping study blocks detected: a block starting at ` +
                `${current.startTime.toISOString()} overlaps one ending at ` +
                `${new Date(previousEnd).toISOString()}.`,
            );
        }
    }
    return sorted;
}
