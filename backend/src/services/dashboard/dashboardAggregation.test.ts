/**
 * Unit tests for the pure Progress Dashboard aggregation logic (task 9.1; Req 5.1, 5.2,
 * 5.3, 5.4, 5.5, 12.4, 12.5).
 *
 * DB- and framework-independent example/edge-case tests for the per-subject study-time
 * sums, the consecutive-day streak (including the zero-when-no-session-today rule), and the
 * syllabus completion percent (including the zero-chapters case). The numbered property
 * tests for aggregation (Property 23, task 9.2), streak (Property 24, task 9.3), and
 * completion (Property 25, task 5.4) are separate tasks and are not implemented here.
 */
import type { ChapterStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
    aggregateFocusBySubject,
    computeStreak,
    computeSyllabusCompletionPercent,
    currentDayWindow,
    currentWeekWindow,
    filterSessionsInWindow,
    startOfUtcDay,
    utcDayKey,
    type FocusSessionRow,
} from './dashboardAggregation';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Build a focus-session row at a given ISO instant. */
function row(subjectId: string, focusedDurationMin: number, startTime: string): FocusSessionRow {
    return { subjectId, focusedDurationMin, startTime: new Date(startTime) };
}

describe('startOfUtcDay / utcDayKey', () => {
    it('truncates an instant to UTC midnight regardless of time of day', () => {
        const d = new Date('2026-03-15T23:59:59.999Z');
        expect(startOfUtcDay(d).toISOString()).toBe('2026-03-15T00:00:00.000Z');
        expect(utcDayKey(d)).toBe('2026-03-15');
    });

    it('does not mutate its input', () => {
        const d = new Date('2026-03-15T12:00:00.000Z');
        startOfUtcDay(d);
        expect(d.toISOString()).toBe('2026-03-15T12:00:00.000Z');
    });
});

describe('currentDayWindow / currentWeekWindow', () => {
    const now = new Date('2026-03-15T08:30:00.000Z');

    it('current day is the half-open UTC day containing now', () => {
        const { start, end } = currentDayWindow(now);
        expect(start.toISOString()).toBe('2026-03-15T00:00:00.000Z');
        expect(end.toISOString()).toBe('2026-03-16T00:00:00.000Z');
    });

    it('current week is the rolling last 7 UTC days ending today', () => {
        const { start, end } = currentWeekWindow(now);
        // today (15th) plus the previous 6 days => starts on the 9th.
        expect(start.toISOString()).toBe('2026-03-09T00:00:00.000Z');
        expect(end.toISOString()).toBe('2026-03-16T00:00:00.000Z');
        expect((end.getTime() - start.getTime()) / MS_PER_DAY).toBe(7);
    });
});

describe('filterSessionsInWindow', () => {
    const window = currentDayWindow(new Date('2026-03-15T08:30:00.000Z'));

    it('includes the window start and excludes the window end (half-open)', () => {
        const sessions = [
            row('phys', 10, '2026-03-15T00:00:00.000Z'), // inclusive start
            row('phys', 10, '2026-03-16T00:00:00.000Z'), // exclusive end
        ];
        const kept = filterSessionsInWindow(sessions, window);
        expect(kept).toHaveLength(1);
        expect(kept[0].startTime.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    });

    it('drops sessions before the window and does not mutate the input', () => {
        const sessions = [row('phys', 10, '2026-03-14T23:59:59.999Z')];
        expect(filterSessionsInWindow(sessions, window)).toHaveLength(0);
        expect(sessions).toHaveLength(1);
    });
});

describe('aggregateFocusBySubject (Req 5.2, 5.3)', () => {
    it('sums focused durations per subject', () => {
        const sessions = [
            row('phys', 30, '2026-03-15T01:00:00.000Z'),
            row('chem', 20, '2026-03-15T02:00:00.000Z'),
            row('phys', 45, '2026-03-15T03:00:00.000Z'),
        ];
        expect(aggregateFocusBySubject(sessions)).toEqual([
            { subjectId: 'chem', focusedDurationMin: 20 },
            { subjectId: 'phys', focusedDurationMin: 75 },
        ]);
    });

    it('counts each session under exactly one subject (no double counting)', () => {
        const sessions = [
            row('phys', 10, '2026-03-15T01:00:00.000Z'),
            row('chem', 10, '2026-03-15T02:00:00.000Z'),
            row('maths', 10, '2026-03-15T03:00:00.000Z'),
        ];
        const result = aggregateFocusBySubject(sessions);
        const total = result.reduce((sum, r) => sum + r.focusedDurationMin, 0);
        expect(total).toBe(30);
        expect(result).toHaveLength(3);
    });

    it('returns an empty array when there are no sessions', () => {
        expect(aggregateFocusBySubject([])).toEqual([]);
    });

    it('returns subjects sorted by subjectId for deterministic output', () => {
        const sessions = [
            row('zoology', 5, '2026-03-15T01:00:00.000Z'),
            row('biology', 5, '2026-03-15T02:00:00.000Z'),
        ];
        expect(aggregateFocusBySubject(sessions).map((r) => r.subjectId)).toEqual([
            'biology',
            'zoology',
        ]);
    });
});

describe('computeStreak (Req 5.4, 5.5)', () => {
    const now = new Date('2026-03-15T08:30:00.000Z');

    it('counts consecutive days ending today', () => {
        const days = [
            new Date('2026-03-15T20:00:00.000Z'),
            new Date('2026-03-14T07:00:00.000Z'),
            new Date('2026-03-13T23:00:00.000Z'),
        ];
        expect(computeStreak(days, now)).toBe(3);
    });

    it('is zero when there is no session today, regardless of prior history (Req 5.5)', () => {
        const days = [
            new Date('2026-03-14T20:00:00.000Z'),
            new Date('2026-03-13T20:00:00.000Z'),
            new Date('2026-03-12T20:00:00.000Z'),
        ];
        expect(computeStreak(days, now)).toBe(0);
    });

    it('stops at the first missing day (a gap breaks the streak)', () => {
        const days = [
            new Date('2026-03-15T20:00:00.000Z'),
            new Date('2026-03-14T20:00:00.000Z'),
            // 13th missing -> streak should be 2
            new Date('2026-03-12T20:00:00.000Z'),
        ];
        expect(computeStreak(days, now)).toBe(2);
    });

    it('collapses multiple sessions on the same day into a single active day', () => {
        const days = [
            new Date('2026-03-15T06:00:00.000Z'),
            new Date('2026-03-15T12:00:00.000Z'),
            new Date('2026-03-15T18:00:00.000Z'),
        ];
        expect(computeStreak(days, now)).toBe(1);
    });

    it('is zero when there are no sessions at all', () => {
        expect(computeStreak([], now)).toBe(0);
    });

    it('counts a single-day streak of exactly one', () => {
        expect(computeStreak([new Date('2026-03-15T00:00:00.000Z')], now)).toBe(1);
    });
});

describe('computeSyllabusCompletionPercent (Req 12.4, 12.5)', () => {
    const statuses = (...s: ChapterStatus[]): ChapterStatus[] => s;

    it('reports 0 percent when there are zero chapters (Req 12.5)', () => {
        expect(computeSyllabusCompletionPercent([])).toBe(0);
    });

    it('counts DONE and REVISED as completed (Req 12.4)', () => {
        expect(
            computeSyllabusCompletionPercent(
                statuses('DONE', 'REVISED', 'IN_PROGRESS', 'NOT_STARTED'),
            ),
        ).toBe(50);
    });

    it('reports 100 percent when all chapters are completed', () => {
        expect(computeSyllabusCompletionPercent(statuses('DONE', 'REVISED'))).toBe(100);
    });

    it('reports 0 percent when no chapter is completed', () => {
        expect(
            computeSyllabusCompletionPercent(statuses('NOT_STARTED', 'IN_PROGRESS')),
        ).toBe(0);
    });

    it('rounds to two decimal places (1 of 3 -> 33.33)', () => {
        expect(
            computeSyllabusCompletionPercent(statuses('DONE', 'NOT_STARTED', 'IN_PROGRESS')),
        ).toBe(33.33);
    });
});
