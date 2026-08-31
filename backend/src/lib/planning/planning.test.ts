import { describe, expect, it } from 'vitest';

import {
    computeCountdownDays,
    computeTimeDebt,
    determinePlanningPhase,
    rankPlanningPriorities,
    recommendedDailyMinutes,
} from './planning';

describe('planning calculations', () => {
    it('computes countdown and phase boundaries', () => {
        const now = new Date('2026-08-01T00:00:00Z');
        expect(computeCountdownDays(new Date('2026-08-31T00:00:00Z'), now)).toBe(30);
        expect(determinePlanningPhase(30)).toBe('FINAL_SPRINT');
        expect(determinePlanningPhase(90)).toBe('REVISION');
        expect(determinePlanningPhase(120)).toBe('COVERAGE');
    });

    it('keeps debt positive and caps wellbeing catch-up', () => {
        expect(computeTimeDebt([{ plannedMin: 120, actualMin: 60 }, { plannedMin: 30, actualMin: 45 }])).toBe(60);
        expect(recommendedDailyMinutes(120, 300, 2)).toBe(150);
    });

    it('prioritizes unfinished and revision work', () => {
        const priorities = rankPlanningPriorities([
            { id: 'a', name: 'Polity', subjectId: 'gs2', status: 'NOT_STARTED', weightage: 1, estimatedStudyHours: 10 },
            { id: 'b', name: 'History', subjectId: 'gs1', status: 'DONE', weightage: 1, estimatedStudyHours: 10 },
        ], 'REVISION');
        expect(priorities[0]?.id).toBe('a');
    });
});
