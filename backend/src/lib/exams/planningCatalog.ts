import type { TaskDifficulty } from '@prisma/client';

import type { ExamProgramKey, ExamStage } from './types';

export interface UnitPlanningProfile {
    /** Relative planning signal only; never presented as an official marks weightage. */
    planningWeight: number;
    estimatedStudyHours: number;
    taskDifficulty: TaskDifficulty;
}

interface Rule {
    pattern: RegExp;
    weight: number;
    hours: number;
    difficulty: TaskDifficulty;
}

const UPSC_RULES: readonly Rule[] = [
    { pattern: /current affairs|editorial|issue-wise/i, weight: 1.35, hours: 16, difficulty: 'HARD' },
    { pattern: /polity|constitution|governance|social justice|international relations/i, weight: 1.3, hours: 18, difficulty: 'HARD' },
    { pattern: /econom|environment|biodiversity|climate|science and technology|internal security/i, weight: 1.25, hours: 18, difficulty: 'HARD' },
    { pattern: /history|heritage|culture|society|geography/i, weight: 1.15, hours: 16, difficulty: 'HARD' },
    { pattern: /ethics|case studies|argument|essay|optional/i, weight: 1.3, hours: 20, difficulty: 'HARD' },
    { pattern: /numeracy|data interpretation|reasoning|mental ability|decision making/i, weight: 1.1, hours: 12, difficulty: 'HARD' },
    { pattern: /comprehension|precis|translation|vocabulary/i, weight: 0.9, hours: 8, difficulty: 'LIGHT' },
];

const SSC_RULES: readonly Rule[] = [
    { pattern: /arithmetic|algebra|geometry|mensuration|trigonometry|data interpretation|number systems/i, weight: 1.35, hours: 12, difficulty: 'HARD' },
    { pattern: /reasoning|series|coding|syllogism|venn|analogy|classification/i, weight: 1.15, hours: 8, difficulty: 'HARD' },
    { pattern: /grammar|sentence correction|cloze|comprehension/i, weight: 1.1, hours: 8, difficulty: 'HARD' },
    { pattern: /vocabulary|active\/passive/i, weight: 0.95, hours: 6, difficulty: 'LIGHT' },
    { pattern: /current affairs|polity|economy|science|history|geography/i, weight: 1.0, hours: 7, difficulty: 'LIGHT' },
    { pattern: /statistics|probability|correlation|regression|dispersion|central tendency/i, weight: 1.25, hours: 10, difficulty: 'HARD' },
    { pattern: /computer|operating systems|network|cyber|office applications/i, weight: 0.8, hours: 5, difficulty: 'LIGHT' },
];

/**
 * Returns transparent, conservative planning defaults for one syllabus unit. These values
 * are workload estimates, not claims about official chapter-wise marks. Users can override
 * both time and allocation after onboarding.
 */
export function getUnitPlanningProfile(
    program: ExamProgramKey,
    stage: ExamStage,
    unit: string,
    subjectPriority: number,
): UnitPlanningProfile {
    const rules = program === 'UPSC_CSE' ? UPSC_RULES : SSC_RULES;
    const match = rules.find((rule) => rule.pattern.test(unit));
    const stageMultiplier = stage === 'MAINS' ? 1.2 : stage === 'TIER_2' ? 1.1 : 1;
    const fallback: Rule = program === 'UPSC_CSE'
        ? { pattern: /.*/, weight: 1, hours: 12, difficulty: 'HARD' }
        : { pattern: /.*/, weight: 1, hours: 7, difficulty: 'LIGHT' };
    const profile = match ?? fallback;

    return {
        planningWeight: Math.round(profile.weight * Math.max(1, subjectPriority) * 100) / 100,
        estimatedStudyHours: Math.max(2, Math.round(profile.hours * stageMultiplier)),
        taskDifficulty: profile.difficulty,
    };
}
