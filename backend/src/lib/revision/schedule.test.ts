import { describe, expect, it } from 'vitest';
import { scheduleNextReview } from './schedule';

describe('revision scheduler', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    it.each([[1, 1], [2, 3], [3, 7], [4, 21]] as const)('uses the canonical +%i interval after review %i', (repetitions, interval) => {
        const result = scheduleNextReview({ intervalDays: 1, ease: 2.5, repetitions: repetitions - 1, lapses: 0 }, 3, now);
        expect(result.intervalDays).toBe(interval);
    });
    it('resets a failed recall to tomorrow', () => {
        const result = scheduleNextReview({ intervalDays: 21, ease: 2.7, repetitions: 4, lapses: 0 }, 1, now);
        expect(result.intervalDays).toBe(1);
        expect(result.dueAt.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    });
});
