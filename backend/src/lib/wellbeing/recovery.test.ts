import { describe, expect, it } from 'vitest';
import { buildThreeDayRecoveryPlan, detectBurnoutRisk } from './recovery';

describe('wellbeing recovery', () => {
    it('detects a high-risk burnout signal', () => {
        expect(detectBurnoutRisk({ averageStress: 4.5, averageEnergy: 1.5, heavyStudyDays: 5, missedPlanDays: 0 })).toBe('HIGH');
    });
    it('creates a three-day graduated recovery plan', () => {
        const plan = buildThreeDayRecoveryPlan(new Date('2026-08-19T00:00:00.000Z'));
        expect(plan).toHaveLength(3);
        expect(plan.map((day) => day.studyMinutes)).toEqual([60, 120, 180]);
    });
});
