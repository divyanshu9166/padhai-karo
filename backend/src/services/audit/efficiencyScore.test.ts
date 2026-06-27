import { describe, expect, it } from 'vitest';

import {
    computeEfficiencyScore,
    DEFAULT_EFFICIENCY_SCORE,
    type EfficiencyAuditRow,
} from './efficiencyScore';

/**
 * DB-independent unit tests for the Efficiency_Score ratio (task 10.2; Req 14.4).
 *
 * The pure function computes Σ actualMin / Σ plannedMin across the audit history, treating
 * the undefined case (no audits / zero total planned) as 1. The numbered property test
 * (Property 28) is task 10.4; these are example/edge-case tests only.
 */
function audits(...rows: Array<[planned: number, actual: number]>): EfficiencyAuditRow[] {
    return rows.map(([plannedMin, actualMin]) => ({ plannedMin, actualMin }));
}

describe('computeEfficiencyScore', () => {
    it('returns the ratio of summed actual to summed planned minutes', () => {
        // (60 + 40) actual / (120 + 80) planned = 100 / 200 = 0.5
        expect(computeEfficiencyScore(audits([120, 60], [80, 40]))).toBe(0.5);
    });

    it('returns exactly 1 when actual equals planned', () => {
        expect(computeEfficiencyScore(audits([100, 100], [50, 50]))).toBe(1);
    });

    it('returns a value above 1 when the user over-completes', () => {
        // 300 actual / 200 planned = 1.5
        expect(computeEfficiencyScore(audits([100, 150], [100, 150]))).toBe(1.5);
    });

    it('treats an empty history as 1 (undefined ratio)', () => {
        expect(computeEfficiencyScore([])).toBe(DEFAULT_EFFICIENCY_SCORE);
        expect(computeEfficiencyScore([])).toBe(1);
    });

    it('treats zero total planned time as 1 even when actual minutes exist', () => {
        expect(computeEfficiencyScore(audits([0, 30], [0, 10]))).toBe(1);
    });

    it('returns 0 when planned time exists but no actual study was logged', () => {
        expect(computeEfficiencyScore(audits([60, 0], [60, 0]))).toBe(0);
    });
});
