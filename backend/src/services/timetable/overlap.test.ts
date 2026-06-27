import { describe, expect, it } from 'vitest';

/**
 * DB-independent unit tests for the pure block-edit overlap logic (task 6.6; design
 * "Edit Validation"; Req 3.4, 3.5, 3.6).
 *
 * These cover the four cases called out in the task: overlapping blocks conflict;
 * adjacent/touching blocks do NOT conflict; a block overlaps a commitment on the SAME
 * weekday; the same time window on a DIFFERENT weekday does not. The shared half-open
 * predicate {@link intervalsOverlap} is exercised directly, and the composed
 * {@link proposedBlockConflicts} gate is checked against both blocks and commitments.
 */
import {
    blockConflictsWithCommitment,
    blockToWeekdayWindow,
    blocksConflict,
    intervalsOverlap,
    proposedBlockConflicts,
    type BlockInterval,
    type RecurringCommitment,
} from './overlap';

/** Build a concrete block from a UTC ISO start and a duration in minutes. */
function block(startIso: string, durationMin: number): BlockInterval {
    return { startTime: new Date(startIso), durationMin };
}

// 2026-01-05 is a Monday (UTC). getUTCDay() === 1.
const MON = '2026-01-05';
const TUE = '2026-01-06';

describe('intervalsOverlap', () => {
    it('is true when intervals overlap', () => {
        expect(intervalsOverlap(0, 10, 5, 15)).toBe(true);
        expect(intervalsOverlap(5, 15, 0, 10)).toBe(true);
    });

    it('is false for touching (back-to-back) intervals', () => {
        expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
        expect(intervalsOverlap(10, 20, 0, 10)).toBe(false);
    });

    it('is false for fully disjoint intervals', () => {
        expect(intervalsOverlap(0, 10, 20, 30)).toBe(false);
    });

    it('is true when one interval fully contains the other', () => {
        expect(intervalsOverlap(0, 100, 40, 50)).toBe(true);
        expect(intervalsOverlap(40, 50, 0, 100)).toBe(true);
    });
});

describe('blocksConflict', () => {
    it('detects overlapping blocks', () => {
        const a = block(`${MON}T09:00:00.000Z`, 60); // 09:00–10:00
        const b = block(`${MON}T09:30:00.000Z`, 60); // 09:30–10:30
        expect(blocksConflict(a, b)).toBe(true);
    });

    it('treats adjacent/touching blocks as non-conflicting', () => {
        const a = block(`${MON}T09:00:00.000Z`, 60); // 09:00–10:00
        const b = block(`${MON}T10:00:00.000Z`, 60); // 10:00–11:00
        expect(blocksConflict(a, b)).toBe(false);
    });

    it('treats blocks on different days as non-conflicting', () => {
        const a = block(`${MON}T09:00:00.000Z`, 60);
        const b = block(`${TUE}T09:00:00.000Z`, 60);
        expect(blocksConflict(a, b)).toBe(false);
    });
});

describe('blockToWeekdayWindow', () => {
    it('maps a UTC start to weekday and minute-of-day window', () => {
        const window = blockToWeekdayWindow(block(`${MON}T09:30:00.000Z`, 90));
        expect(window.dayOfWeek).toBe(1); // Monday
        expect(window.startMinute).toBe(9 * 60 + 30); // 570
        expect(window.endMinute).toBe(9 * 60 + 30 + 90); // 660
    });
});

describe('blockConflictsWithCommitment', () => {
    const commitment: RecurringCommitment = {
        dayOfWeek: 1, // Monday
        startTime: '08:00',
        endTime: '10:00',
    };

    it('conflicts with a commitment on the same weekday and overlapping time', () => {
        const b = block(`${MON}T09:00:00.000Z`, 60); // Mon 09:00–10:00 ⟂ 08:00–10:00
        expect(blockConflictsWithCommitment(b, commitment)).toBe(true);
    });

    it('does not conflict on a different weekday at the same time-of-day', () => {
        const b = block(`${TUE}T09:00:00.000Z`, 60); // Tuesday, commitment is Monday
        expect(blockConflictsWithCommitment(b, commitment)).toBe(false);
    });

    it('does not conflict when the time windows merely touch', () => {
        const b = block(`${MON}T10:00:00.000Z`, 60); // Mon 10:00–11:00, commitment ends 10:00
        expect(blockConflictsWithCommitment(b, commitment)).toBe(false);
    });

    it('treats a malformed commitment time as non-conflicting', () => {
        const bad: RecurringCommitment = { dayOfWeek: 1, startTime: 'oops', endTime: '10:00' };
        const b = block(`${MON}T09:00:00.000Z`, 60);
        expect(blockConflictsWithCommitment(b, bad)).toBe(false);
    });
});

describe('proposedBlockConflicts', () => {
    const commitment: RecurringCommitment = {
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '10:00',
    };

    it('returns false when the proposed block is clear of all peers and commitments', () => {
        const proposed = block(`${MON}T11:00:00.000Z`, 60);
        const others = [block(`${MON}T12:00:00.000Z`, 60)];
        expect(proposedBlockConflicts(proposed, others, [commitment])).toBe(false);
    });

    it('returns true when the proposed block overlaps another study block', () => {
        const proposed = block(`${MON}T12:30:00.000Z`, 60);
        const others = [block(`${MON}T12:00:00.000Z`, 60)]; // 12:00–13:00 ⟂ 12:30–13:30
        expect(proposedBlockConflicts(proposed, others, [])).toBe(true);
    });

    it('returns true when the proposed block overlaps a fixed commitment', () => {
        const proposed = block(`${MON}T09:00:00.000Z`, 60); // ⟂ Mon 08:00–10:00
        expect(proposedBlockConflicts(proposed, [], [commitment])).toBe(true);
    });

    it('returns false against an empty peer/commitment set', () => {
        expect(proposedBlockConflicts(block(`${MON}T09:00:00.000Z`, 60), [], [])).toBe(false);
    });
});
