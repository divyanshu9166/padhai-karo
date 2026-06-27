/**
 * Unit (example) tests for STEP 1 — the free-time grid (Req 3.1). DB-independent.
 */
import { describe, expect, it } from 'vitest';

import { parseHHmm } from '@/services/onboarding/validation';

import {
    DEFAULT_WAKING_WINDOW,
    computeFreeTimeGrid,
    expandDayToSlotStarts,
    freeMinutesInDay,
} from './grid';
import { SLOT_MINUTES, type GridCommitment, type MinuteInterval } from './types';

/** All intervals across the grid must be 30-min aligned and strictly ascending. */
function assertSlotAligned(intervals: MinuteInterval[]): void {
    let prevEnd = -1;
    for (const interval of intervals) {
        expect(interval.startMinute % SLOT_MINUTES).toBe(0);
        expect(interval.endMinute % SLOT_MINUTES).toBe(0);
        expect(interval.endMinute).toBeGreaterThan(interval.startMinute);
        expect(interval.startMinute).toBeGreaterThanOrEqual(prevEnd);
        prevEnd = interval.endMinute;
    }
}

/** True when free interval `f` overlaps the half-open busy interval `[bStart, bEnd)`. */
function overlaps(f: MinuteInterval, bStart: number, bEnd: number): boolean {
    return f.startMinute < bEnd && bStart < f.endMinute;
}

describe('computeFreeTimeGrid', () => {
    it('returns seven days ordered 0..6', () => {
        const grid = computeFreeTimeGrid([]);
        expect(grid).toHaveLength(7);
        expect(grid.map((d) => d.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('with no commitments the whole default waking window is free', () => {
        const grid = computeFreeTimeGrid([]);
        const start = parseHHmm(DEFAULT_WAKING_WINDOW.start)!;
        const end = parseHHmm(DEFAULT_WAKING_WINDOW.end)!;
        for (const day of grid) {
            expect(day.intervals).toEqual([{ startMinute: start, endMinute: end }]);
            expect(freeMinutesInDay(day)).toBe(end - start);
        }
    });

    it('subtracts a single commitment, splitting the window around it', () => {
        const commitments: GridCommitment[] = [
            { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
        ];
        const monday = computeFreeTimeGrid(commitments)[1];
        expect(monday.intervals).toEqual([
            { startMinute: parseHHmm('06:00')!, endMinute: parseHHmm('09:00')! },
            { startMinute: parseHHmm('12:00')!, endMinute: parseHHmm('23:00')! },
        ]);
        assertSlotAligned(monday.intervals);
    });

    it('free intervals never overlap any commitment on the day', () => {
        const commitments: GridCommitment[] = [
            { dayOfWeek: 2, startTime: '07:30', endTime: '08:30' },
            { dayOfWeek: 2, startTime: '13:00', endTime: '14:00' },
            { dayOfWeek: 2, startTime: '18:00', endTime: '20:00' },
        ];
        const tuesday = computeFreeTimeGrid(commitments)[2];
        for (const commitment of commitments) {
            const bStart = parseHHmm(commitment.startTime)!;
            const bEnd = parseHHmm(commitment.endTime)!;
            for (const free of tuesday.intervals) {
                expect(overlaps(free, bStart, bEnd)).toBe(false);
            }
        }
        assertSlotAligned(tuesday.intervals);
    });

    it('handles multiple overlapping/adjacent commitments by merging them', () => {
        const commitments: GridCommitment[] = [
            { dayOfWeek: 3, startTime: '09:00', endTime: '10:30' },
            { dayOfWeek: 3, startTime: '10:00', endTime: '11:00' }, // overlaps previous
            { dayOfWeek: 3, startTime: '11:00', endTime: '12:00' }, // adjacent to previous
        ];
        const wednesday = computeFreeTimeGrid(commitments)[3];
        expect(wednesday.intervals).toEqual([
            { startMinute: parseHHmm('06:00')!, endMinute: parseHHmm('09:00')! },
            { startMinute: parseHHmm('12:00')!, endMinute: parseHHmm('23:00')! },
        ]);
    });

    it('snaps non-aligned commitment boundaries inward to 30-min slots', () => {
        // Commitment ends at 07:15 -> free time starts at the next slot 07:30, never 07:15.
        const commitments: GridCommitment[] = [
            { dayOfWeek: 4, startTime: '06:00', endTime: '07:15' },
        ];
        const thursday = computeFreeTimeGrid(commitments)[4];
        expect(thursday.intervals).toEqual([
            { startMinute: parseHHmm('07:30')!, endMinute: parseHHmm('23:00')! },
        ]);
        assertSlotAligned(thursday.intervals);
    });

    it('drops sub-slot gaps smaller than 30 minutes', () => {
        // Only a 15-min gap (08:00-08:15) exists between two commitments -> no usable slot.
        const commitments: GridCommitment[] = [
            { dayOfWeek: 5, startTime: '06:00', endTime: '08:00' },
            { dayOfWeek: 5, startTime: '08:15', endTime: '23:00' },
        ];
        const friday = computeFreeTimeGrid(commitments)[5];
        expect(friday.intervals).toEqual([]);
        expect(freeMinutesInDay(friday)).toBe(0);
    });

    it('a commitment spanning the whole waking window yields no free slots', () => {
        const commitments: GridCommitment[] = [
            { dayOfWeek: 6, startTime: '06:00', endTime: '23:00' },
        ];
        const saturday = computeFreeTimeGrid(commitments)[6];
        expect(saturday.intervals).toEqual([]);
    });

    it('respects a custom waking window', () => {
        const grid = computeFreeTimeGrid([], { start: '08:00', end: '22:00' });
        expect(grid[0].intervals).toEqual([
            { startMinute: parseHHmm('08:00')!, endMinute: parseHHmm('22:00')! },
        ]);
    });

    it('only subtracts commitments belonging to the day in question', () => {
        const commitments: GridCommitment[] = [
            { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
        ];
        const grid = computeFreeTimeGrid(commitments);
        // Sunday (0) is untouched by Monday's commitment.
        expect(grid[0].intervals).toEqual([
            { startMinute: parseHHmm('06:00')!, endMinute: parseHHmm('23:00')! },
        ]);
    });

    it('expands a day into 30-min slot start minutes', () => {
        const commitments: GridCommitment[] = [
            { dayOfWeek: 0, startTime: '07:00', endTime: '22:00' },
        ];
        const sunday = computeFreeTimeGrid(commitments)[0];
        // Free intervals are 06:00-07:00 and 22:00-23:00 => slots at 360, 390, 1320, 1350.
        expect(expandDayToSlotStarts(sunday)).toEqual([360, 390, 1320, 1350]);
    });

    it('throws on a malformed waking window', () => {
        expect(() => computeFreeTimeGrid([], { start: '23:00', end: '06:00' })).toThrow();
        expect(() => computeFreeTimeGrid([], { start: 'bad', end: '23:00' })).toThrow();
    });
});
