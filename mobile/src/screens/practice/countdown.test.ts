import { describe, expect, it } from 'vitest';

import { elapsedSec, formatClock, initialRemainingSec, isExpired, tick } from './countdown';

/**
 * Unit tests for the pure Timed Paper Mode countdown logic (task 21.6).
 *
 * Focus is on the running countdown (Req 19.1), the auto-submit-at-zero trigger (Req 19.3),
 * and the elapsed `timeTakenSec` accounting for both auto- and manual submission.
 */
describe('timed paper countdown', () => {
    it('derives the starting seconds from the paper duration in minutes (Req 19.1)', () => {
        expect(initialRemainingSec(180)).toBe(10_800);
        expect(initialRemainingSec(0)).toBe(0);
        expect(initialRemainingSec(-5)).toBe(0);
        expect(initialRemainingSec(Number.NaN)).toBe(0);
    });

    it('ticks down by one second and clamps at zero (never negative)', () => {
        expect(tick(2)).toBe(1);
        expect(tick(1)).toBe(0);
        expect(tick(0)).toBe(0);
        expect(tick(-3)).toBe(0);
    });

    it('flags expiry exactly when the clock reaches zero, driving auto-submit (Req 19.3)', () => {
        expect(isExpired(5)).toBe(false);
        expect(isExpired(1)).toBe(false);
        expect(isExpired(0)).toBe(true);
        expect(isExpired(-1)).toBe(true);

        // Ticking a 3s clock to zero is what fires the auto-submit.
        let remaining = initialRemainingSec(0.05); // 3 seconds
        expect(remaining).toBe(3);
        let ticks = 0;
        while (!isExpired(remaining)) {
            remaining = tick(remaining);
            ticks += 1;
        }
        expect(ticks).toBe(3);
        expect(remaining).toBe(0);
    });

    it('reports the full duration as elapsed on auto-submit at zero (Req 19.3)', () => {
        expect(elapsedSec(120, 0)).toBe(7_200);
    });

    it('reports only the time actually spent on an early manual submit', () => {
        // 120-minute paper submitted with 90 minutes (5400s) left → 30 minutes elapsed.
        expect(elapsedSec(120, 5_400)).toBe(1_800);
    });

    it('clamps elapsed time into [0, totalSec] even with out-of-range remaining values', () => {
        const totalSec = initialRemainingSec(60); // 3600
        expect(elapsedSec(60, -10)).toBe(totalSec); // remaining below zero → full duration
        expect(elapsedSec(60, totalSec + 999)).toBe(0); // remaining above total → nothing elapsed
    });

    it('formats the remaining clock as mm:ss and hh:mm:ss', () => {
        expect(formatClock(0)).toBe('00:00');
        expect(formatClock(65)).toBe('01:05');
        expect(formatClock(3_661)).toBe('01:01:01');
        expect(formatClock(-5)).toBe('00:00');
    });
});
