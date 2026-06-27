import { describe, expect, it } from 'vitest';

import {
    computeRecentRatePerDay,
    computeRemainingHours,
    effectiveEstimatedHours,
    isPendingChapter,
    projectVelocity,
    RECENT_RATE_WINDOW_DAYS,
    type VelocityAuditRow,
    type VelocityChapterRow,
} from './velocity';

/**
 * DB-independent unit tests for the Study_Velocity projection pieces (task 10.2; Req 14.6,
 * 14.7, 14.8). The numbered property test (Property 30) is task 10.5; these are
 * example/edge-case tests only.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function chapter(
    status: string,
    estimatedStudyHours: number,
    estHoursOverride?: number | null,
): VelocityChapterRow {
    return { status, estimatedStudyHours, estHoursOverride };
}

describe('isPendingChapter', () => {
    it('treats NOT_STARTED and IN_PROGRESS as pending', () => {
        expect(isPendingChapter('NOT_STARTED')).toBe(true);
        expect(isPendingChapter('IN_PROGRESS')).toBe(true);
    });

    it('treats DONE and REVISED as not pending', () => {
        expect(isPendingChapter('DONE')).toBe(false);
        expect(isPendingChapter('REVISED')).toBe(false);
    });
});

describe('effectiveEstimatedHours', () => {
    it('uses the override when present', () => {
        expect(effectiveEstimatedHours(chapter('NOT_STARTED', 10, 4))).toBe(4);
    });

    it('falls back to the base estimate when the override is null/undefined', () => {
        expect(effectiveEstimatedHours(chapter('NOT_STARTED', 10, null))).toBe(10);
        expect(effectiveEstimatedHours(chapter('NOT_STARTED', 10))).toBe(10);
    });

    it('honors an override of 0 (override precedence over base)', () => {
        expect(effectiveEstimatedHours(chapter('NOT_STARTED', 10, 0))).toBe(0);
    });
});

describe('computeRemainingHours', () => {
    it('sums only pending chapters using override precedence', () => {
        const chapters = [
            chapter('NOT_STARTED', 10), // pending -> 10
            chapter('IN_PROGRESS', 5, 8), // pending, override -> 8
            chapter('DONE', 100), // excluded
            chapter('REVISED', 50), // excluded
        ];
        expect(computeRemainingHours(chapters)).toBe(18);
    });

    it('returns 0 when there are no chapters', () => {
        expect(computeRemainingHours([])).toBe(0);
    });

    it('returns 0 when every chapter is complete', () => {
        expect(computeRemainingHours([chapter('DONE', 20), chapter('REVISED', 30)])).toBe(0);
    });
});

describe('computeRecentRatePerDay', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');

    function auditOn(isoDay: string, actualMin: number): VelocityAuditRow {
        return { date: new Date(isoDay), actualMin };
    }

    it('averages actual hours in the window over the full window length in days', () => {
        // 420 min today = 7 hours; spread over the 7-day window => 1 hour/day.
        const rate = computeRecentRatePerDay([auditOn('2026-01-01T00:00:00.000Z', 420)], now);
        expect(rate).toBe(7 / RECENT_RATE_WINDOW_DAYS);
        expect(rate).toBe(1);
    });

    it('sums multiple in-window audits before dividing by the window length', () => {
        const audits = [
            auditOn('2026-01-01T00:00:00.000Z', 120),
            auditOn('2025-12-31T00:00:00.000Z', 180),
            auditOn('2025-12-26T00:00:00.000Z', 120), // first day still in the 7-day window
        ];
        // (120 + 180 + 120) / 60 = 7 hours over 7 days = 1 hour/day.
        expect(computeRecentRatePerDay(audits, now)).toBe(1);
    });

    it('ignores audits older than the window', () => {
        const audits = [auditOn('2025-12-25T00:00:00.000Z', 4200)]; // 8 days before -> excluded
        expect(computeRecentRatePerDay(audits, now)).toBe(0);
    });

    it('returns 0 when there are no audits', () => {
        expect(computeRecentRatePerDay([], now)).toBe(0);
    });
});

describe('projectVelocity', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const todayStart = new Date('2026-01-01T00:00:00.000Z');

    it('reports AHEAD with the whole-day delta when projected finish precedes target', () => {
        const result = projectVelocity({
            remainingHours: 10,
            recentRatePerDay: 5, // ceil(10/5) = 2 days -> 2026-01-03
            targetCompletionDate: new Date('2026-01-10T00:00:00.000Z'),
            now,
        });
        expect(result.status).toBe('AHEAD');
        expect(result.projectedCompletionDate).toEqual(new Date('2026-01-03T00:00:00.000Z'));
        expect(result.deltaDays).toBe(7);
    });

    it('reports BEHIND with the whole-day delta when projected finish exceeds target', () => {
        const result = projectVelocity({
            remainingHours: 100,
            recentRatePerDay: 5, // ceil(100/5) = 20 days -> 2026-01-21
            targetCompletionDate: new Date('2026-01-10T00:00:00.000Z'),
            now,
        });
        expect(result.status).toBe('BEHIND');
        expect(result.projectedCompletionDate).toEqual(new Date('2026-01-21T00:00:00.000Z'));
        expect(result.deltaDays).toBe(11);
    });

    it('treats finishing exactly on the target date as AHEAD with delta 0', () => {
        const result = projectVelocity({
            remainingHours: 50,
            recentRatePerDay: 5, // ceil(50/5) = 10 days -> 2026-01-11
            targetCompletionDate: new Date('2026-01-11T00:00:00.000Z'),
            now,
        });
        expect(result.status).toBe('AHEAD');
        expect(result.deltaDays).toBe(0);
    });

    it('rounds projected days up (ceil) for a fractional remaining/rate', () => {
        const result = projectVelocity({
            remainingHours: 11,
            recentRatePerDay: 5, // 11/5 = 2.2 -> ceil = 3 days -> 2026-01-04
            targetCompletionDate: new Date('2026-01-10T00:00:00.000Z'),
            now,
        });
        expect(result.projectedCompletionDate).toEqual(new Date('2026-01-04T00:00:00.000Z'));
    });

    it('reports an indefinite/behind projection when the recent rate is 0 with work left', () => {
        const result = projectVelocity({
            remainingHours: 25,
            recentRatePerDay: 0,
            targetCompletionDate: new Date('2026-01-10T00:00:00.000Z'),
            now,
        });
        expect(result.status).toBe('BEHIND');
        expect(result.projectedCompletionDate).toBeNull();
        expect(result.deltaDays).toBeNull();
    });

    it('projects completion as today when no work remains, even at a 0 rate', () => {
        const result = projectVelocity({
            remainingHours: 0,
            recentRatePerDay: 0,
            targetCompletionDate: new Date('2026-01-10T00:00:00.000Z'),
            now,
        });
        expect(result.status).toBe('AHEAD');
        expect(result.projectedCompletionDate).toEqual(todayStart);
        expect(result.deltaDays).toBe(9);
    });

    it('does not mutate the provided now/target dates', () => {
        const target = new Date('2026-01-10T00:00:00.000Z');
        const nowCopy = new Date(now.getTime());
        projectVelocity({ remainingHours: 10, recentRatePerDay: 5, targetCompletionDate: target, now: nowCopy });
        expect(target.toISOString()).toBe('2026-01-10T00:00:00.000Z');
        expect(nowCopy.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        // sanity: window math constant unchanged
        expect(MS_PER_DAY).toBe(86400000);
    });
});
