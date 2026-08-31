import { describe, expect, it } from 'vitest';
import { simulateStrategy } from './practiceStrategy';

describe('practice strategy simulator', () => {
    it('flags an impossible target before exam day', () => {
        const result = simulateStrategy({ questionCount: 100, totalTimeSec: 3600, targetAttempted: 100, averageReadSec: 50, reviewSec: 300 });
        expect(result.feasibility).toBe('UNREALISTIC');
        expect(result.advice.length).toBeGreaterThan(0);
    });
});
