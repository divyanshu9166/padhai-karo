import { describe, expect, it } from 'vitest';

import { getUnitPlanningProfile } from './planningCatalog';

describe('UPSC/SSC unit planning profiles', () => {
    it('gives demanding quantitative units more time than lightweight computer units', () => {
        const quant = getUnitPlanningProfile('SSC_CGL', 'TIER_1', 'Trigonometry', 1);
        const computer = getUnitPlanningProfile('SSC_CGL', 'TIER_2', 'Computer basics', 1);
        expect(quant.estimatedStudyHours).toBeGreaterThan(computer.estimatedStudyHours);
        expect(quant.taskDifficulty).toBe('HARD');
        expect(computer.taskDifficulty).toBe('LIGHT');
    });

    it('keeps values positive and applies stage/subject planning multipliers', () => {
        const base = getUnitPlanningProfile('UPSC_CSE', 'PRELIMS', 'Comprehension', 1);
        const mains = getUnitPlanningProfile('UPSC_CSE', 'MAINS', 'Essay structure', 2);
        expect(base.estimatedStudyHours).toBeGreaterThan(0);
        expect(mains.estimatedStudyHours).toBeGreaterThan(base.estimatedStudyHours);
        expect(mains.planningWeight).toBeGreaterThan(base.planningWeight);
    });
});
