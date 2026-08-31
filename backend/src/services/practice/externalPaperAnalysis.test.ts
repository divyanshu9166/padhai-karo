import { describe, expect, it } from 'vitest';

import { analyseExternalPaper } from './externalPaperAnalysis';
import { validateExternalPaperReviewInput } from './externalPaperReviewValidation';

describe('analyseExternalPaper', () => {
    it('creates an actionable, non-predictive plan from a verified input boundary', () => {
        const parsed = validateExternalPaperReviewInput({
            title: 'SSC CGL Tier 1 mock', testDate: '2026-08-12T10:00:00.000Z', obtainedScore: 54, maxScore: 100,
            breakdown: [{ label: 'Quant', obtainedScore: 8, maxScore: 25 }, { label: 'Reasoning', obtainedScore: 20, maxScore: 25 }],
            mistakeTags: ['CONCEPT_GAP', 'SILLY_MISTAKE'],
        });
        if (!parsed.ok) throw new Error('Fixture must be valid');

        const analysis = analyseExternalPaper(parsed.value, 49);
        expect(analysis.scorePercent).toBe(54);
        expect(analysis.scoreChangePoints).toBe(5);
        expect(analysis.priorityAreas[0]).toMatchObject({ label: 'Quant', scorePercent: 32 });
        expect(analysis.actionPlan.length).toBeGreaterThanOrEqual(3);
        expect(analysis.disclaimer.toLowerCase()).toContain('does not predict rank');
    });
});
