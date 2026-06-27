/**
 * Property-based test for the pure Efficiency_Score computation.
 *
 *   - Property 28 (task 10.4): efficiency score equals ratio (Req 14.4).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the {@link computeEfficiencyScore} logic it validates.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    computeEfficiencyScore,
    DEFAULT_EFFICIENCY_SCORE,
    type EfficiencyAuditRow,
} from './efficiencyScore';

describe('efficiencyScore properties', () => {
    // Feature: jee-neet-study-app, Property 28: For any daily-audit history, the efficiency
    // score equals total actual study time divided by total planned study time.
    it('Property 28: efficiency score equals ratio (Req 14.4)', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        plannedMin: fc.nat({ max: 1000 }),
                        actualMin: fc.nat({ max: 1000 }),
                    }),
                    { maxLength: 50 },
                ),
                (audits: EfficiencyAuditRow[]) => {
                    const totalPlanned = audits.reduce((s, a) => s + a.plannedMin, 0);
                    const totalActual = audits.reduce((s, a) => s + a.actualMin, 0);

                    const result = computeEfficiencyScore(audits);

                    if (totalPlanned > 0) {
                        expect(result).toBe(totalActual / totalPlanned);
                    } else {
                        // undefined ratio (no audits / zero planned) is treated as on-plan.
                        expect(result).toBe(DEFAULT_EFFICIENCY_SCORE);
                    }
                },
            ),
        );
    });
});
