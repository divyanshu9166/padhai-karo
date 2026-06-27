import { describe, expect, it } from 'vitest';

/**
 * DB-independent unit tests for the pure STEP-9 materializer (task 6.5; Req 3.1, 3.2, 3.3,
 * 15.1, 12.3). These exercise the concrete-block construction directly — no Prisma, no clock
 * — asserting the guarantees the task requires of the persisted result:
 *
 *   - no two produced blocks overlap in time (Req 3.3) and none overlap a fixed commitment,
 *     which holds because blocks only occupy free-grid slots (Req 3.1);
 *   - study blocks are distributed across every subject with a positive allocation (Req 3.2);
 *   - a proportional set of buffer slots (~10–15%) is reserved with no subject/chapter (Req 15.1);
 *   - only the supplied (pending) chapters appear — the materializer never invents work (Req 12.3).
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */
import { computeFreeTimeGrid } from '@/lib/timetable/grid';
import { computeWeeklyBudget, weekDatesFromStart } from '@/lib/timetable/budget';
import type { GridCommitment } from '@/lib/timetable/types';

import {
    assertNoOverlap,
    buildConcreteSlots,
    materializeTimetable,
    splitStudyAndBuffer,
    SLOT_HOURS,
    type MaterializeChapter,
    type MaterializedBlock,
} from './materialize';

const MS_PER_MINUTE = 60 * 1000;

/** A Monday UTC-midnight week start (2026-01-05 is a Monday). */
const WEEK_START = new Date('2026-01-05T00:00:00.000Z');

function blockEnd(block: MaterializedBlock): number {
    return block.startTime.getTime() + block.durationMin * MS_PER_MINUTE;
}

/** Assert no two blocks overlap by checking sorted adjacency directly (independent of helper). */
function expectNoOverlap(blocks: MaterializedBlock[]): void {
    const sorted = [...blocks].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].startTime.getTime()).toBeGreaterThanOrEqual(blockEnd(sorted[i - 1]));
    }
}

/** Convert an "HH:mm" string to minutes since midnight. */
function hhmmToMin(value: string): number {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
}

/** Assert no block overlaps any fixed commitment on its weekday. */
function expectNoCommitmentOverlap(
    blocks: MaterializedBlock[],
    commitments: GridCommitment[],
): void {
    for (const block of blocks) {
        const dayOfWeek = block.startTime.getUTCDay();
        const dayStart = Date.UTC(
            block.startTime.getUTCFullYear(),
            block.startTime.getUTCMonth(),
            block.startTime.getUTCDate(),
        );
        const startMin = (block.startTime.getTime() - dayStart) / MS_PER_MINUTE;
        const endMin = startMin + block.durationMin;
        for (const commitment of commitments.filter((c) => c.dayOfWeek === dayOfWeek)) {
            const csMin = hhmmToMin(commitment.startTime);
            const ceMin = hhmmToMin(commitment.endTime);
            // No overlap: block ends at/before commitment start OR starts at/after its end.
            expect(endMin <= csMin || startMin >= ceMin).toBe(true);
        }
    }
}

describe('splitStudyAndBuffer', () => {
    it('reserves a ~12.5% buffer when capacity is ample', () => {
        // 70 study slots demanded, buffer ratio 0.125/0.875 ≈ 0.142857 → 10 buffer slots.
        const { studySlots, bufferSlots } = splitStudyAndBuffer(70, 1000, 12.5, 87.5);
        expect(studySlots).toBe(70);
        expect(bufferSlots).toBe(10);
        const fraction = bufferSlots / (studySlots + bufferSlots);
        expect(fraction).toBeGreaterThanOrEqual(0.1);
        expect(fraction).toBeLessThanOrEqual(0.15);
    });

    it('fills the grid while preserving the buffer fraction when capacity binds', () => {
        const capacity = 80;
        const { studySlots, bufferSlots } = splitStudyAndBuffer(1000, capacity, 12.5, 87.5);
        expect(studySlots + bufferSlots).toBe(capacity);
        const fraction = bufferSlots / (studySlots + bufferSlots);
        expect(fraction).toBeGreaterThanOrEqual(0.1);
        expect(fraction).toBeLessThanOrEqual(0.15);
    });

    it('returns zero buffer when there is no assignable time', () => {
        expect(splitStudyAndBuffer(10, 100, 5, 0)).toEqual({ studySlots: 10, bufferSlots: 0 });
    });

    it('returns nothing for empty demand or capacity', () => {
        expect(splitStudyAndBuffer(0, 100, 12.5, 87.5)).toEqual({ studySlots: 0, bufferSlots: 0 });
        expect(splitStudyAndBuffer(50, 0, 12.5, 87.5)).toEqual({ studySlots: 0, bufferSlots: 0 });
    });
});

describe('buildConcreteSlots', () => {
    it('skips dates excluded by a Mock_Test and aligns start times to the grid', () => {
        const weekDates = weekDatesFromStart(WEEK_START);
        const freeGrid = computeFreeTimeGrid([], { start: '09:00', end: '11:00' });
        // Exclude the first date (Monday) via a Mock_Test.
        const budget = computeWeeklyBudget(weekDates, [
            { type: 'MOCK_TEST', startDate: weekDates[0], endDate: weekDates[0] },
        ]);

        const slots = buildConcreteSlots(weekDates, budget.perDay, freeGrid, []);

        // 09:00–11:00 → 4 slots/day × 6 schedulable days (Monday excluded).
        expect(slots).toHaveLength(4 * 6);
        // No slot falls on the excluded Monday.
        expect(slots.some((slot) => slot.startTime.getTime() === weekDates[0].getTime() + 9 * 60 * MS_PER_MINUTE)).toBe(false);
        // Slots are chronologically ordered.
        for (let i = 1; i < slots.length; i += 1) {
            expect(slots[i].startTime.getTime()).toBeGreaterThan(slots[i - 1].startTime.getTime());
        }
    });

    it('tags slots HIGH only inside a marked peak window', () => {
        const weekDates = weekDatesFromStart(WEEK_START);
        // 08:00–13:00; MORNING band is 05:00–12:00, so 08–12 are HIGH, 12–13 LOW.
        const freeGrid = computeFreeTimeGrid([], { start: '08:00', end: '13:00' });
        const budget = computeWeeklyBudget(weekDates, []);

        const withPeak = buildConcreteSlots(weekDates, budget.perDay, freeGrid, ['MORNING']);
        const monday = withPeak.filter((slot) => slot.dayOfWeek === 1);
        expect(monday.find((s) => s.startMinute === 8 * 60)?.energyLevel).toBe('HIGH');
        expect(monday.find((s) => s.startMinute === 12 * 60)?.energyLevel).toBe('LOW');

        const noPeak = buildConcreteSlots(weekDates, budget.perDay, freeGrid, []);
        expect(noPeak.every((slot) => slot.energyLevel === 'LOW')).toBe(true);
    });
});

describe('materializeTimetable', () => {
    const commitments: GridCommitment[] = [
        // School every weekday morning; leaves afternoons/evenings free.
        { dayOfWeek: 1, startTime: '08:00', endTime: '14:00' },
        { dayOfWeek: 2, startTime: '08:00', endTime: '14:00' },
        { dayOfWeek: 3, startTime: '08:00', endTime: '14:00' },
        { dayOfWeek: 4, startTime: '08:00', endTime: '14:00' },
        { dayOfWeek: 5, startTime: '08:00', endTime: '14:00' },
    ];

    const allocations: MaterializeChapter[] = [
        { chapterId: 'phy-1', subjectId: 'physics', allocatedHours: 6, taskDifficulty: 'HARD' },
        { chapterId: 'che-1', subjectId: 'chemistry', allocatedHours: 5, taskDifficulty: 'LIGHT' },
        { chapterId: 'mat-1', subjectId: 'maths', allocatedHours: 7, taskDifficulty: 'HARD' },
    ];

    function run() {
        const weekDates = weekDatesFromStart(WEEK_START);
        const freeGrid = computeFreeTimeGrid(commitments, { start: '06:00', end: '23:00' });
        const budget = computeWeeklyBudget(weekDates, []);
        return materializeTimetable({
            weekDates,
            perDayLoads: budget.perDay,
            freeGrid,
            peakWindows: ['MORNING'],
            allocations,
            bufferHours: 2.25, // 12.5% of an 18h study demand → ratio honoured
            assignableHours: 18,
            subjectPriority: ['physics', 'maths', 'chemistry'],
        });
    }

    it('produces non-overlapping study and buffer blocks (Req 3.3) clear of commitments (Req 3.1)', () => {
        const { studyBlocks, bufferSlots } = run();
        const all = [...studyBlocks, ...bufferSlots];
        expect(all.length).toBeGreaterThan(0);
        expectNoOverlap(all);
        expectNoCommitmentOverlap(all, commitments);
        // The dedicated invariant guard agrees and does not throw.
        expect(() => assertNoOverlap(all)).not.toThrow();
    });

    it('distributes study blocks across every subject with a positive allocation (Req 3.2)', () => {
        const { studyBlocks } = run();
        const subjects = new Set(studyBlocks.map((block) => block.subjectId));
        expect(subjects).toEqual(new Set(['physics', 'chemistry', 'maths']));
    });

    it('reserves buffer slots (~10–15%) with no subject or chapter (Req 15.1)', () => {
        const { studyBlocks, bufferSlots } = run();
        expect(bufferSlots.length).toBeGreaterThan(0);
        for (const buffer of bufferSlots) {
            expect(buffer.isBuffer).toBe(true);
            expect(buffer.subjectId).toBeNull();
            expect(buffer.chapterId).toBeNull();
        }
        const studyMinutes = studyBlocks.reduce((sum, b) => sum + b.durationMin, 0);
        const bufferMinutes = bufferSlots.reduce((sum, b) => sum + b.durationMin, 0);
        const fraction = bufferMinutes / (studyMinutes + bufferMinutes);
        expect(fraction).toBeGreaterThanOrEqual(0.1);
        expect(fraction).toBeLessThanOrEqual(0.15);
    });

    it('schedules only the supplied (pending) chapters (Req 12.3)', () => {
        const { studyBlocks } = run();
        const chapters = new Set(studyBlocks.map((block) => block.chapterId));
        expect(chapters).toEqual(new Set(['phy-1', 'che-1', 'mat-1']));
    });

    it('emits blocks whose durations are positive multiples of the slot length', () => {
        const { studyBlocks, bufferSlots } = run();
        for (const block of [...studyBlocks, ...bufferSlots]) {
            expect(block.durationMin).toBeGreaterThan(0);
            expect(block.durationMin % (SLOT_HOURS * 60)).toBe(0);
        }
    });

    it('returns an empty timetable when there are no pending chapters', () => {
        const weekDates = weekDatesFromStart(WEEK_START);
        const freeGrid = computeFreeTimeGrid(commitments);
        const budget = computeWeeklyBudget(weekDates, []);
        const result = materializeTimetable({
            weekDates,
            perDayLoads: budget.perDay,
            freeGrid,
            peakWindows: [],
            allocations: [],
            bufferHours: 0,
            assignableHours: 0,
            subjectPriority: [],
        });
        expect(result.studyBlocks).toEqual([]);
        expect(result.bufferSlots).toEqual([]);
    });
});

describe('assertNoOverlap', () => {
    it('throws when two blocks overlap', () => {
        const base = new Date('2026-01-05T09:00:00.000Z');
        const blocks: MaterializedBlock[] = [
            { subjectId: 'a', chapterId: 'c1', startTime: base, durationMin: 60, isBuffer: false, energyLevel: 'LOW', scheduledOutsidePeak: false },
            { subjectId: 'b', chapterId: 'c2', startTime: new Date(base.getTime() + 30 * MS_PER_MINUTE), durationMin: 60, isBuffer: false, energyLevel: 'LOW', scheduledOutsidePeak: false },
        ];
        expect(() => assertNoOverlap(blocks)).toThrow(/overlap/i);
    });

    it('accepts adjacent (touching) blocks', () => {
        const base = new Date('2026-01-05T09:00:00.000Z');
        const blocks: MaterializedBlock[] = [
            { subjectId: 'a', chapterId: 'c1', startTime: base, durationMin: 30, isBuffer: false, energyLevel: 'LOW', scheduledOutsidePeak: false },
            { subjectId: 'b', chapterId: 'c2', startTime: new Date(base.getTime() + 30 * MS_PER_MINUTE), durationMin: 30, isBuffer: false, energyLevel: 'LOW', scheduledOutsidePeak: false },
        ];
        expect(() => assertNoOverlap(blocks)).not.toThrow();
    });
});
