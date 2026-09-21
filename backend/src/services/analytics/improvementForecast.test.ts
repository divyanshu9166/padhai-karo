import { describe, expect, it } from 'vitest';
import { forecastNextPracticeScore } from './improvementForecast';

const point = (day: number, score: number, maxScore = 200) => ({ date: new Date(Date.UTC(2026, 0, day)), obtainedScore: score, maxScore });

describe('forecastNextPracticeScore', () => {
    it('requires three valid comparable attempts', () => {
        expect(forecastNextPracticeScore([point(1, 80), point(2, 90)])).toMatchObject({ kind: 'INSUFFICIENT_DATA', available: 2 });
    });

    it('returns a bounded range instead of a guaranteed single score', () => {
        const result = forecastNextPracticeScore([point(1, 80), point(2, 92), point(3, 100), point(4, 108)]);
        expect(result.kind).toBe('ESTIMATE');
        if (result.kind !== 'ESTIMATE') return;
        expect(result.estimatedNextPercent.low).toBeLessThan(result.estimatedNextPercent.high);
        expect(result.estimatedNextMarks.low).toBeGreaterThanOrEqual(0);
        expect(result.estimatedNextMarks.high).toBeLessThanOrEqual(200);
        expect(result.disclaimer).toMatch(/not a guaranteed score/i);
    });

    it('does not mutate input and ignores invalid points', () => {
        const input = Object.freeze([point(3, 100), point(1, 80), point(2, 90), point(4, 500)]);
        const result = forecastNextPracticeScore(input);
        expect(result).toMatchObject({ kind: 'ESTIMATE', sampleSize: 3 });
        expect(input[0].date.getUTCDate()).toBe(3);
    });
});
