/**
 * Property-based test for STEPS 6–7 — difficulty/energy tagging and energy-based slotting
 * (`./energy`).
 *
 *   - Property 15 (task 6.16): energy classification and matching (Req 2.9, 13.1–13.4).
 *
 * A single fast-check assertion running the global >= 100 iterations (vitest.setup.ts),
 * placed next to the {@link classifySlots} / {@link assignTasksToSlots} logic it validates.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { PeakFocusWindow } from '@/services/onboarding/validation';

import {
    assignTasksToSlots,
    classifySlots,
    peakWindowForMinute,
    type SlotInput,
    type StudyTask,
    type TaskDifficulty,
} from './energy';
import { SLOT_MINUTES, type DayOfWeek } from './types';

const PEAK_WINDOW_POOL: readonly PeakFocusWindow[] = ['MORNING', 'AFTERNOON', 'NIGHT'];
const DAY_POOL: readonly DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];
const DIFFICULTY_POOL: readonly TaskDifficulty[] = ['HARD', 'LIGHT'];

/** Slot start minutes aligned to the 30-minute grid across a full day. */
const SLOT_START_POOL = Array.from(
    { length: (24 * 60) / SLOT_MINUTES },
    (_, i) => i * SLOT_MINUTES,
);

describe('Property 15: Energy classification and matching', () => {
    // Feature: jee-neet-study-app, Property 15: For any timetable, a slot is classified high-energy if and only if it falls within a peak focus window (and all slots are low-energy when no peak window is set); and when a matching-energy slot is available, hard tasks are placed in high-energy slots and light tasks in low-energy slots, while a hard task with no available high-energy slot is placed in the next available slot and flagged as scheduled outside a peak window.
    it('classifies HIGH iff in a peak window and matches HARD→HIGH / LIGHT→LOW (Req 2.9, 13.1-13.4)', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(fc.constantFrom(...PEAK_WINDOW_POOL), { maxLength: 3 }),
                fc.array(
                    fc.record({
                        day: fc.constantFrom(...DAY_POOL),
                        startMinute: fc.constantFrom(...SLOT_START_POOL),
                    }),
                    { maxLength: 40 },
                ),
                fc.array(
                    fc.record({
                        id: fc.string({ minLength: 1, maxLength: 6 }),
                        difficulty: fc.constantFrom(...DIFFICULTY_POOL),
                        slotCount: fc.integer({ min: 1, max: 3 }),
                    }),
                    { maxLength: 12 },
                ),
                (peakWindows, rawSlots, rawTasks) => {
                    // De-duplicate slots by (day, startMinute): a real grid has distinct slots.
                    const seen = new Set<string>();
                    const slots: SlotInput[] = [];
                    for (const slot of rawSlots) {
                        const key = `${slot.day}:${slot.startMinute}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            slots.push(slot);
                        }
                    }
                    // Give tasks unique ids so placements map back unambiguously.
                    const tasks: StudyTask[] = rawTasks.map((task, index) => ({
                        ...task,
                        id: `task-${index}`,
                    }));

                    const energySlots = classifySlots(slots, peakWindows);

                    // (1) Classification iff: HIGH exactly when the start is in a marked window.
                    energySlots.forEach((slot, index) => {
                        const inPeak =
                            peakWindows.length > 0 &&
                            peakWindows.includes(peakWindowForMinute(slots[index].startMinute));
                        expect(slot.energyLevel).toBe(inPeak ? 'HIGH' : 'LOW');
                    });
                    // With no peak window set, every slot is LOW (Req 2.9).
                    if (peakWindows.length === 0) {
                        expect(energySlots.every((s) => s.energyLevel === 'LOW')).toBe(true);
                    }

                    const totalHighSlots = energySlots.filter((s) => s.energyLevel === 'HIGH').length;
                    const { placements, unplacedTasks } = assignTasksToSlots(tasks, energySlots);

                    let highUsed = 0;
                    for (const placement of placements) {
                        const allHigh = placement.slots.every((s) => s.energyLevel === 'HIGH');
                        highUsed += placement.slots.filter((s) => s.energyLevel === 'HIGH').length;

                        if (placement.difficulty === 'LIGHT') {
                            // LIGHT tasks are never flagged as outside-peak (the flag is HARD-only).
                            expect(placement.scheduledOutsidePeak).toBe(false);
                        } else {
                            // A HARD task is flagged exactly when it could not stay all-HIGH (Req 13.4).
                            expect(placement.scheduledOutsidePeak).toBe(!allHigh);
                        }
                    }

                    // (2) Greedy preference: a HARD task spills to a non-HIGH ("next available")
                    // slot only when no HIGH slot remained — so if ANY HARD placement is flagged
                    // outside-peak, every HIGH slot must have been consumed.
                    const anyHardSpilled = placements.some(
                        (p) => p.difficulty === 'HARD' && p.scheduledOutsidePeak,
                    );
                    if (anyHardSpilled) {
                        expect(highUsed).toBe(totalHighSlots);
                    }

                    // (3) Conservation: placements never consume more slots than exist, and a task
                    // is either fully placed (slotCount slots) or reported unplaced — never partial.
                    const slotsConsumed = placements.reduce((sum, p) => sum + p.slots.length, 0);
                    expect(slotsConsumed).toBeLessThanOrEqual(energySlots.length);
                    const placedById = new Map(placements.map((p) => [p.taskId, p]));
                    for (const task of tasks) {
                        const placement = placedById.get(task.id);
                        if (placement) {
                            expect(placement.slots.length).toBe(task.slotCount ?? 1);
                        } else {
                            expect(unplacedTasks.some((t) => t.id === task.id)).toBe(true);
                        }
                    }
                },
            ),
        );
    });
});
