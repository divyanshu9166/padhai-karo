/**
 * Unit (example) tests for STEPS 6–7 — difficulty/energy tagging and energy-based slotting
 * (Req 2.9, 13.1, 13.2, 13.3, 13.4). DB-independent. Property 15 (task 6.16) is separate.
 */
import { describe, expect, it } from 'vitest';

import type { PeakFocusWindow } from '@/services/onboarding/validation';

import {
    PEAK_WINDOW_BANDS,
    assignTasksToSlots,
    classifySlotEnergy,
    classifySlots,
    peakWindowForMinute,
    type EnergySlot,
    type StudyTask,
} from './energy';
import { type DayOfWeek } from './types';

/** Build a slot at a given day/time for terser tests. */
function slot(day: DayOfWeek, startMinute: number, energyLevel: 'HIGH' | 'LOW'): EnergySlot {
    return { day, startMinute, energyLevel };
}

const HHMM = (h: number, m = 0): number => h * 60 + m;

describe('peakWindowForMinute', () => {
    it('maps minutes into the documented MORNING/AFTERNOON/NIGHT bands', () => {
        // Boundaries are half-open [start, end).
        expect(peakWindowForMinute(HHMM(5))).toBe('MORNING'); // 05:00 start inclusive
        expect(peakWindowForMinute(HHMM(11, 59))).toBe('MORNING');
        expect(peakWindowForMinute(HHMM(12))).toBe('AFTERNOON'); // 12:00 start inclusive
        expect(peakWindowForMinute(HHMM(16, 59))).toBe('AFTERNOON');
        expect(peakWindowForMinute(HHMM(17))).toBe('NIGHT'); // 17:00 start inclusive
        expect(peakWindowForMinute(HHMM(23, 59))).toBe('NIGHT');
        // NIGHT wraps the small hours before 05:00.
        expect(peakWindowForMinute(HHMM(0))).toBe('NIGHT');
        expect(peakWindowForMinute(HHMM(4, 59))).toBe('NIGHT');
    });

    it('the three bands tile the whole day with no gaps or overlaps', () => {
        // Every minute of the day resolves to exactly one window.
        for (let minute = 0; minute < 24 * 60; minute += 1) {
            const window = peakWindowForMinute(minute);
            expect(['MORNING', 'AFTERNOON', 'NIGHT']).toContain(window);
        }
        // Sanity: the band intervals cover exactly 1440 minutes in total.
        const total = (Object.keys(PEAK_WINDOW_BANDS) as PeakFocusWindow[]).reduce(
            (sum, key) =>
                sum +
                PEAK_WINDOW_BANDS[key].reduce(
                    (s, i) => s + (i.endMinute - i.startMinute),
                    0,
                ),
            0,
        );
        expect(total).toBe(24 * 60);
    });
});

describe('classifySlotEnergy (STEP 6, Req 13.1 / 2.9)', () => {
    it('is HIGH when the slot start falls within a marked peak window', () => {
        const windows: PeakFocusWindow[] = ['MORNING'];
        expect(classifySlotEnergy(HHMM(9), windows)).toBe('HIGH'); // 09:00 is morning
        expect(classifySlotEnergy(HHMM(14), windows)).toBe('LOW'); // 14:00 is afternoon
    });

    it('is LOW when the slot start falls outside every marked peak window', () => {
        const windows: PeakFocusWindow[] = ['NIGHT'];
        expect(classifySlotEnergy(HHMM(10), windows)).toBe('LOW'); // morning, not marked
        expect(classifySlotEnergy(HHMM(20), windows)).toBe('HIGH'); // night, marked
    });

    it('treats every slot as LOW when no peak window is set (Req 2.9)', () => {
        for (let h = 0; h < 24; h += 1) {
            expect(classifySlotEnergy(HHMM(h), [])).toBe('LOW');
        }
    });

    it('supports multiple marked windows', () => {
        const windows: PeakFocusWindow[] = ['MORNING', 'NIGHT'];
        expect(classifySlotEnergy(HHMM(8), windows)).toBe('HIGH'); // morning
        expect(classifySlotEnergy(HHMM(13), windows)).toBe('LOW'); // afternoon (not marked)
        expect(classifySlotEnergy(HHMM(22), windows)).toBe('HIGH'); // night
    });
});

describe('classifySlots (STEP 6)', () => {
    it('tags a list of slots preserving order', () => {
        const slots = [
            { day: 1 as DayOfWeek, startMinute: HHMM(9) },
            { day: 1 as DayOfWeek, startMinute: HHMM(14) },
            { day: 2 as DayOfWeek, startMinute: HHMM(20) },
        ];
        const tagged = classifySlots(slots, ['MORNING', 'NIGHT']);
        expect(tagged.map((s) => s.energyLevel)).toEqual(['HIGH', 'LOW', 'HIGH']);
        // Original fields are carried through unchanged.
        expect(tagged[0]).toMatchObject({ day: 1, startMinute: HHMM(9) });
    });

    it('tags all slots LOW when no peak window is set (Req 2.9)', () => {
        const slots = [
            { day: 0 as DayOfWeek, startMinute: HHMM(9) },
            { day: 0 as DayOfWeek, startMinute: HHMM(20) },
        ];
        expect(classifySlots(slots, []).every((s) => s.energyLevel === 'LOW')).toBe(true);
    });
});

describe('assignTasksToSlots (STEP 7, Req 13.2/13.3/13.4)', () => {
    it('places HARD tasks into HIGH-energy slots and LIGHT tasks into LOW-energy slots', () => {
        const slots: EnergySlot[] = [
            slot(1, HHMM(9), 'HIGH'),
            slot(1, HHMM(14), 'LOW'),
        ];
        const tasks: StudyTask[] = [
            { id: 'hard-1', difficulty: 'HARD' },
            { id: 'light-1', difficulty: 'LIGHT' },
        ];
        const { placements, unplacedTasks } = assignTasksToSlots(tasks, slots);

        expect(unplacedTasks).toEqual([]);
        const hard = placements.find((p) => p.taskId === 'hard-1')!;
        const light = placements.find((p) => p.taskId === 'light-1')!;

        expect(hard.energyLevel).toBe('HIGH');
        expect(hard.scheduledOutsidePeak).toBe(false);
        expect(hard.slots[0].startMinute).toBe(HHMM(9));

        expect(light.energyLevel).toBe('LOW');
        expect(light.scheduledOutsidePeak).toBe(false);
        expect(light.slots[0].startMinute).toBe(HHMM(14));
    });

    it('spills a HARD task into the next available slot and flags it when no HIGH slot remains (Req 13.4)', () => {
        // Only LOW slots available => the HARD task must go outside a peak window.
        const slots: EnergySlot[] = [slot(1, HHMM(14), 'LOW'), slot(1, HHMM(15), 'LOW')];
        const tasks: StudyTask[] = [{ id: 'hard-1', difficulty: 'HARD' }];

        const { placements } = assignTasksToSlots(tasks, slots);
        const hard = placements[0];

        expect(hard.scheduledOutsidePeak).toBe(true);
        expect(hard.energyLevel).toBe('LOW');
        // It took the NEXT AVAILABLE slot (earliest by day/time).
        expect(hard.slots[0].startMinute).toBe(HHMM(14));
    });

    it('places a HARD task in HIGH and a later HARD task spills when HIGH is exhausted', () => {
        const slots: EnergySlot[] = [slot(1, HHMM(9), 'HIGH'), slot(1, HHMM(14), 'LOW')];
        const tasks: StudyTask[] = [
            { id: 'hard-1', difficulty: 'HARD' },
            { id: 'hard-2', difficulty: 'HARD' },
        ];
        const { placements } = assignTasksToSlots(tasks, slots);

        expect(placements[0]).toMatchObject({
            taskId: 'hard-1',
            energyLevel: 'HIGH',
            scheduledOutsidePeak: false,
        });
        expect(placements[1]).toMatchObject({
            taskId: 'hard-2',
            energyLevel: 'LOW',
            scheduledOutsidePeak: true,
        });
    });

    it('spills a LIGHT task into a HIGH slot without flagging when no LOW slot remains', () => {
        const slots: EnergySlot[] = [slot(1, HHMM(9), 'HIGH')];
        const tasks: StudyTask[] = [{ id: 'light-1', difficulty: 'LIGHT' }];

        const light = assignTasksToSlots(tasks, slots).placements[0];
        expect(light.energyLevel).toBe('HIGH');
        expect(light.scheduledOutsidePeak).toBe(false); // flag is HARD-only (Req 13.4)
    });

    it('reports tasks that do not fit as unplaced without consuming slots', () => {
        const slots: EnergySlot[] = [slot(1, HHMM(9), 'HIGH')];
        const tasks: StudyTask[] = [
            { id: 'big', difficulty: 'HARD', slotCount: 2 }, // needs 2, only 1 slot
            { id: 'small', difficulty: 'LIGHT' }, // should still get the slot
        ];
        const { placements, unplacedTasks } = assignTasksToSlots(tasks, slots);

        expect(unplacedTasks.map((t) => t.id)).toEqual(['big']);
        expect(placements.map((p) => p.taskId)).toEqual(['small']);
        expect(placements[0].slots).toHaveLength(1);
    });

    it('places a multi-slot HARD task across consecutive HIGH slots', () => {
        const slots: EnergySlot[] = [
            slot(1, HHMM(9), 'HIGH'),
            slot(1, HHMM(9, 30), 'HIGH'),
            slot(1, HHMM(14), 'LOW'),
        ];
        const tasks: StudyTask[] = [{ id: 'hard-2slot', difficulty: 'HARD', slotCount: 2 }];

        const hard = assignTasksToSlots(tasks, slots).placements[0];
        expect(hard.slots).toHaveLength(2);
        expect(hard.energyLevel).toBe('HIGH');
        expect(hard.scheduledOutsidePeak).toBe(false);
        expect(hard.slots.map((s) => s.startMinute)).toEqual([HHMM(9), HHMM(9, 30)]);
    });

    it('flags a multi-slot HARD task that partially spills into a LOW slot (Req 13.4)', () => {
        const slots: EnergySlot[] = [slot(1, HHMM(9), 'HIGH'), slot(1, HHMM(14), 'LOW')];
        const tasks: StudyTask[] = [{ id: 'hard-2slot', difficulty: 'HARD', slotCount: 2 }];

        const hard = assignTasksToSlots(tasks, slots).placements[0];
        expect(hard.slots).toHaveLength(2);
        // Preferred HIGH slot taken first, then spilled to LOW.
        expect(hard.slots.map((s) => s.energyLevel)).toEqual(['HIGH', 'LOW']);
        expect(hard.scheduledOutsidePeak).toBe(true);
        expect(hard.energyLevel).toBe('LOW');
    });

    it('consumes slots in ascending (day, startMinute) order regardless of input order', () => {
        // Slots given out of order; matching must still pick the earliest matching slot.
        const slots: EnergySlot[] = [
            slot(2, HHMM(9), 'HIGH'),
            slot(0, HHMM(20), 'HIGH'),
            slot(1, HHMM(8), 'HIGH'),
        ];
        const tasks: StudyTask[] = [{ id: 'hard-1', difficulty: 'HARD' }];
        const hard = assignTasksToSlots(tasks, slots).placements[0];
        // Earliest by (day, startMinute) is day 0 @ 20:00.
        expect(hard.slots[0]).toMatchObject({ day: 0, startMinute: HHMM(20) });
    });

    it('is deterministic: identical inputs yield identical placements', () => {
        const slots: EnergySlot[] = [
            slot(1, HHMM(9), 'HIGH'),
            slot(1, HHMM(10), 'HIGH'),
            slot(1, HHMM(14), 'LOW'),
            slot(2, HHMM(15), 'LOW'),
        ];
        const tasks: StudyTask[] = [
            { id: 'h1', difficulty: 'HARD' },
            { id: 'l1', difficulty: 'LIGHT' },
            { id: 'h2', difficulty: 'HARD' },
            { id: 'l2', difficulty: 'LIGHT' },
        ];
        const first = assignTasksToSlots(tasks, slots);
        const second = assignTasksToSlots(tasks, slots);
        expect(first).toEqual(second);
    });

    it('does not mutate the input slot array', () => {
        const slots: EnergySlot[] = [slot(2, HHMM(9), 'HIGH'), slot(0, HHMM(8), 'HIGH')];
        const snapshot = slots.map((s) => ({ ...s }));
        assignTasksToSlots([{ id: 'h', difficulty: 'HARD' }], slots);
        expect(slots).toEqual(snapshot);
    });

    it('returns no placements when there are no slots', () => {
        const tasks: StudyTask[] = [{ id: 'h', difficulty: 'HARD' }];
        const { placements, unplacedTasks } = assignTasksToSlots(tasks, []);
        expect(placements).toEqual([]);
        expect(unplacedTasks.map((t) => t.id)).toEqual(['h']);
    });
});
