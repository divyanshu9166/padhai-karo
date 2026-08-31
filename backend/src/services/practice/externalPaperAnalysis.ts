import type { ExternalPaperMistakeTag, PaperBreakdownInput, ValidExternalPaperReviewInput } from './externalPaperReviewValidation';

export interface ExternalPaperAnalysis {
    scorePercent: number;
    previousScorePercent: number | null;
    scoreChangePoints: number | null;
    confidence: { level: 'EARLY_SIGNAL' | 'PATTERN_FORMING'; message: string };
    encouragement: string;
    priorityAreas: Array<{ label: string; scorePercent: number; reason: string }>;
    actionPlan: string[];
    disclaimer: string;
}

function percent(obtained: number, maximum: number): number {
    return Math.round((obtained / maximum) * 1000) / 10;
}

function tagAction(tag: ExternalPaperMistakeTag): string {
    const actions: Record<ExternalPaperMistakeTag, string> = {
        CONCEPT_GAP: 'Choose the top concept gap and rebuild it with one short lesson, then solve 10 focused questions.',
        SILLY_MISTAKE: 'Keep a one-line error checklist and use it during the final five minutes of the next paper.',
        TIME_PRESSURE: 'Run one 25-minute pacing drill this week: easy questions first, then return to flagged ones.',
        REVISION_GAP: 'Make a compact revision card for the missed facts or rules and review it on +1, +3, +7 and +21 days.',
        UNATTEMPTED: 'Review unattempted questions separately: mark whether each was unfamiliar, time-limited, or intentionally skipped.',
    };
    return actions[tag];
}

/**
 * Produces a deterministic, supportive study plan from self-reported marks. It intentionally
 * does not infer a rank, selection chance, or exam result from an external paper.
 */
export function analyseExternalPaper(
    input: ValidExternalPaperReviewInput,
    previousScorePercent: number | null,
): ExternalPaperAnalysis {
    const scorePercent = percent(input.obtainedScore, input.maxScore);
    const scoreChangePoints = previousScorePercent === null ? null : Math.round((scorePercent - previousScorePercent) * 10) / 10;
    const priorityAreas = input.breakdown
        .map((section) => ({ label: section.label, scorePercent: percent(section.obtainedScore, section.maxScore), reason: '' }))
        .sort((a, b) => a.scorePercent - b.scorePercent)
        .slice(0, 3);
    const withReasons = priorityAreas.map((item) => ({
        ...item,
        reason: item.scorePercent < 45
            ? 'This section has the clearest recovery opportunity in your next study blocks.'
            : item.scorePercent < 70
                ? 'A targeted revision-and-practice cycle can make this section more reliable.'
                : 'Keep this strength warm with short mixed practice, without taking time from lower sections.',
    }));
    const actions = input.mistakeTags.map(tagAction);
    if (withReasons.length > 0) {
        actions.unshift(`Schedule two focused blocks for ${withReasons[0].label}: revise first, then complete a timed set and log the errors.`);
    } else {
        actions.unshift('Before the next paper, split your score into sections so the next review can identify the best place to improve.');
    }
    if (actions.length < 3) actions.push('After your next attempt, compare the same sections and adjust only one study habit at a time.');
    if (actions.length < 3) actions.push('Protect sleep and a short reset before the next timed paper; reliable practice is more useful than cramming.');

    const encouragement = scorePercent < 40
        ? 'This paper is a baseline, not a verdict. One clear correction cycle is a meaningful next step.'
        : scorePercent < 70
            ? 'You have a workable base. Focused review can turn more of your preparation into marks.'
            : 'This is solid evidence of progress. Keep testing your approach across different papers and conditions.';

    return {
        scorePercent,
        previousScorePercent,
        scoreChangePoints,
        confidence: {
            level: previousScorePercent === null ? 'EARLY_SIGNAL' : 'PATTERN_FORMING',
            message: previousScorePercent === null
                ? 'One paper is an early study signal. Add a few reviews before treating a pattern as reliable.'
                : 'This comparison is a study signal, based on self-reported papers—not a prediction of an exam result.',
        },
        encouragement,
        priorityAreas: withReasons,
        actionPlan: actions.slice(0, 4),
        disclaimer: 'This review helps plan your next study actions. It does not predict rank, selection, or an exam outcome.',
    };
}

// Keeps the section type in this module’s public API without leaking persistence details.
export type ExternalPaperSection = PaperBreakdownInput;
