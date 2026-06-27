/**
 * Property-based tests for STEP 9 — the pure materializer that turns the abstract
 * allocation/slotting result into concrete `StudyBlock`s (`./materialize`).
 *
 *   - Property 8 (task 6.9): no-overlap invariant (Req 3.1, 3.3).
 *   - Property 10 (task 6.11): multi-subject distribution (Req 3.2, 17.2, 17.3).
 *
 * Each property is a single fast-check assertion running the global >= 100 iterations
 * (vitest.setup.ts), driving the real generation helpers (free grid → budget → materialize).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { computeFreeTimeGrid } from '@/lib/timetable/grid';
import { computeWeeklyBudget, weekDatesFromStart } from '@/lib/timetable/budget';
import type { GridCommitment } from '@/lib/timetable/types';
import type { PeakFocusWindow } from '@/services/onboarding/validation';

import {
    assertNoOverlap,
    materializeTimetable,
    type MaterializeChapter,
    type MaterializedBlock,
} from './materialize';

const MS_PER_MINUTE = 60 * 1000;
const WEEK_START = new Date('2026-01-05T00:00:00.000Z'); // a Monday (UTC)
const SUBJECT_POOL = ['physics', 'chemistry', 'maths'] as const;
const PEAK_WINDOW_POOL: readonly PeakFocusWindow[] = ['MORNING', 'AFTERNOON', 'NIGHT'];
const DIFFICULTY_POOL = ['HARD', 'LIGHT'] as const;

/** Two non-overlapping "HH:mm" commitment windows for a weekday, or none. */
function commitmentArb(dayOfWeek: number): fc.Arbitrary<GridCommitment[]> {
    return fc
        .option(
            fc.record({
                startHour: fc.integer({ min: 7, max: 11 }),
                length: fc.integer({ min: 1, max: 4 }),
            }),
            { nil: null },
        )
        .map((window) => {
            if (!window) return [];
            const start = window.startHour;
            const end = start + window.length;
            const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
            return [{ dayOfWeek, startTime: pad(start), endTime: pad(end) }];
        });
}

function hhmmToMin(value: string): number {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
}

/** Assert no block overlaps any fixed commitment recurring on its weekday (Req 3.1). */
function expectNoCommitmentOverlap(
    blocks: MaterializedBlock[],
    commitments: GridCommitment[],
): void {
    for (const block of blocks) {
        const dayOfWeek = block.startTime.getUTCDay();
        const utcMidnight =
            Math.floor(block.startTime.getTime() / (24 * 60 * MS_PER_MINUTE)) *
            (24 * 60 * MS_PER_MINUTE);
        const startMin = (block.startTime.getTime() - utcMidnight) / MS_PER_MINUTE;
        const endMin = startMin + block.durationMin;
        for (const c of commitments.filter((x) => x.dayOfWeek === dayOfWeek)) {
            const cs = hhmmToMin(c.startTime);
            const ce = hhmmToMin(c.endTime);
            expect(endMin <= cs || startMin >= ce).toBe(true);
        }
    }
}

describe('materialize properties', () => {
    // Feature: jee-neet-study-app, Property 8: For any set of fixed commitments and pending chapters, every generated timetable has no two study blocks overlapping in time and no study block overlapping any fixed commitment.
    it('Property 8: no-overlap invariant (Req 3.1, 3.3)', () => {
        fc.assert(
            fc.property(
                // A commitment window per weekday (0..6).
                fc.tuple(...Array.from({ length: 7 }, (_, day) => commitmentArb(day))),
                fc.uniqueArray(fc.constantFrom(...PEAK_WINDOW_POOL), { maxLength: 3 }),
                fc.array(
                    fc.record({
                        subjectId: fc.constantFrom(...SUBJECT_POOL),
                        allocatedHours: fc.float({ min: 0, max: 8, noNaN: true }),
                        taskDifficulty: fc.constantFrom(...DIFFICULTY_POOL),
                    }),
                    { maxLength: 10 },
                ),
                (commitmentsByDay, peakWindows, rawAllocations) => {
                    const commitments = commitmentsByDay.flat();
                    const allocations: MaterializeChapter[] = rawAllocations.map((a, index) => ({
                        chapterId: `ch-${index}`,
                        subjectId: a.subjectId,
                        allocatedHours: a.allocatedHours,
                        taskDifficulty: a.taskDifficulty,
                    }));

                    const weekDates = weekDatesFromStart(WEEK_START);
                    const freeGrid = computeFreeTimeGrid(commitments, { start: '06:00', end: '23:00' });
                    const budget = computeWeeklyBudget(weekDates, []);

                    const studyDemand = allocations.reduce((s, a) => s + a.allocatedHours, 0);
                    const result = materializeTimetable({
                        weekDates,
                        perDayLoads: budget.perDay,
                        freeGrid,
                        peakWindows,
                        allocations,
                        bufferHours: studyDemand * 0.142857,
                        assignableHours: studyDemand > 0 ? studyDemand : 1,
                        subjectPriority: [...SUBJECT_POOL],
                    });

                    const all = [...result.studyBlocks, ...result.bufferSlots];
                    // No two blocks overlap in time (Req 3.3) — the invariant guard does not throw.
                    expect(() => assertNoOverlap(all)).not.toThrow();
                    // No block overlaps a fixed commitment (Req 3.1).
                    expectNoCommitmentOverlap(all, commitments);
                },
            ),
        );
    });

    // Feature: jee-neet-study-app, Property 10: For any generation input in which more than one subject has pending chapters, the generated timetable contains at least one study block for each such subject.
    it('Property 10: multi-subject distribution (Req 3.2, 17.2, 17.3)', () => {
        fc.assert(
            fc.property(
                // A positive whole-hour allocation per subject for a non-empty subset of subjects.
                fc
                    .uniqueArray(fc.constantFrom(...SUBJECT_POOL), { minLength: 2, maxLength: 3 })
                    .chain((subjects) =>
                        fc.tuple(
                            fc.constant(subjects),
                            fc.array(fc.integer({ min: 1, max: 4 }), {
                                minLength: subjects.length,
                                maxLength: subjects.length,
                            }),
                        ),
                    ),
                ([subjects, hours]) => {
                    const allocations: MaterializeChapter[] = subjects.map((subjectId, index) => ({
                        chapterId: `${subjectId}-ch`,
                        subjectId,
                        allocatedHours: hours[index],
                        taskDifficulty: 'HARD',
                    }));

                    const weekDates = weekDatesFromStart(WEEK_START);
                    // Ample free grid (no commitments) so every subject's work fits.
                    const freeGrid = computeFreeTimeGrid([], { start: '06:00', end: '23:00' });
                    const budget = computeWeeklyBudget(weekDates, []);
                    const studyDemand = allocations.reduce((s, a) => s + a.allocatedHours, 0);

                    const result = materializeTimetable({
                        weekDates,
                        perDayLoads: budget.perDay,
                        freeGrid,
                        peakWindows: [],
                        allocations,
                        bufferHours: studyDemand * 0.142857,
                        assignableHours: studyDemand,
                        subjectPriority: [...SUBJECT_POOL],
                    });

                    const scheduledSubjects = new Set(
                        result.studyBlocks.map((block) => block.subjectId),
                    );
                    // Every subject with a positive allocation gets at least one study block.
                    for (const subjectId of subjects) {
                        expect(scheduledSubjects.has(subjectId)).toBe(true);
                    }
                },
            ),
        );
    });
});
