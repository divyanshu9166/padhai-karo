import type { ExamProgram, ExamStage } from '@prisma/client';

export interface ExamGuidance {
    program: ExamProgram;
    stage: ExamStage;
    focus: string[];
    checklist: string[];
    careerContext: string[];
    currentAffairsBuckets: string[];
}

const GUIDANCE: ExamGuidance[] = [
    { program: 'UPSC_CSE', stage: 'PRELIMS', focus: ['Build breadth across the General Studies syllabus.', 'Practice elimination and timed MCQ sets.', 'Keep current affairs linked to static concepts.'], checklist: ['Admit card and photo ID', 'Black/blue pen as permitted by the notice', 'Reach the centre early', 'Read the latest official instructions'], careerContext: ['Prelims is a screening stage; plan the next stage alongside it.', 'Explore services, cadre preferences and eligibility only from the latest official notice.'], currentAffairsBuckets: ['Polity and governance', 'Economy', 'Environment', 'Science and technology', 'International relations'] },
    { program: 'UPSC_CSE', stage: 'MAINS', focus: ['Write structured answers with a clear demand analysis.', 'Revise optional and General Studies notes through active recall.', 'Use examples, reports and constitutional references carefully.'], checklist: ['Admit card and photo ID', 'Stationery allowed by the latest notice', 'Reach the centre early', 'Review the latest official instructions'], careerContext: ['Map service and cadre preferences to the current official rules.', 'Use counseling prompts to compare work profile, location and long-term fit.'], currentAffairsBuckets: ['Governance', 'Social justice', 'Economy', 'Security', 'Ethics and essays'] },
    { program: 'SSC_CGL', stage: 'TIER_1', focus: ['Build speed and accuracy across every section.', 'Use section-wise timed drills.', 'Review calculation and reasoning errors the same day.'], checklist: ['Admit card and photo ID', 'Follow the latest computer-based test instructions', 'Reach the centre early', 'Do not carry prohibited items'], careerContext: ['Compare likely posts and departments using the current official notice.', 'Keep post preference decisions separate from day-to-day score anxiety.'], currentAffairsBuckets: ['National events', 'Economy', 'Government schemes', 'Static GK', 'Science and technology'] },
    { program: 'SSC_CGL', stage: 'TIER_2', focus: ['Use section timing checkpoints.', 'Practise the exact paper mix in timed conditions.', 'Maintain a short error-to-revision loop.'], checklist: ['Admit card and photo ID', 'Required computer-based test documents', 'Reach the centre early', 'Review the latest official instructions'], careerContext: ['Compare post, department, work location and promotion context from the latest notice.', 'Re-check eligibility and preference rules before submission.'], currentAffairsBuckets: ['Economy', 'Government schemes', 'Static GK', 'National events', 'Reports and indices'] },
];

export function getExamGuidance(program: ExamProgram, stage: ExamStage): ExamGuidance {
    return GUIDANCE.find((item) => item.program === program && item.stage === stage) ?? GUIDANCE[0];
}

export function getExamGuidanceCatalog(): ExamGuidance[] { return GUIDANCE; }
