/** Pure planning calculations shared by the planning overview and Daily Briefing. */

export type PlanningPhase = 'COVERAGE' | 'REVISION' | 'FINAL_SPRINT' | 'EXAM_DAY_PASSED';

export interface AuditSignal {
    plannedMin: number;
    actualMin: number;
}

export interface ChapterSignal {
    id: string;
    name: string;
    status: string;
    weightage: number;
    estimatedStudyHours: number;
    subjectId: string;
}

export interface PlanningPriority {
    id: string;
    name: string;
    subjectId: string;
    reason: 'NOT_STARTED' | 'IN_PROGRESS' | 'REVISION_DUE' | 'HIGH_WEIGHTAGE';
    score: number;
}

export function computeCountdownDays(targetExamDate: Date | null, now: Date): number | null {
    if (!targetExamDate) return null;
    return Math.ceil((targetExamDate.getTime() - now.getTime()) / 86_400_000);
}

export function determinePlanningPhase(countdownDays: number | null): PlanningPhase {
    if (countdownDays !== null && countdownDays < 0) return 'EXAM_DAY_PASSED';
    if (countdownDays !== null && countdownDays <= 30) return 'FINAL_SPRINT';
    if (countdownDays !== null && countdownDays <= 90) return 'REVISION';
    return 'COVERAGE';
}

export function computeTimeDebt(audits: readonly AuditSignal[]): number {
    return audits.reduce((debt, audit) => debt + Math.max(0, audit.plannedMin - audit.actualMin), 0);
}

export function computeStudyCredit(audits: readonly AuditSignal[]): number {
    return audits.reduce((credit, audit) => credit + Math.max(0, audit.actualMin - audit.plannedMin), 0);
}

export function computeAverageEfficiency(audits: readonly AuditSignal[]): number {
    if (audits.length === 0) return 0;
    const planned = audits.reduce((sum, audit) => sum + Math.max(0, audit.plannedMin), 0);
    const actual = audits.reduce((sum, audit) => sum + Math.max(0, audit.actualMin), 0);
    return planned === 0 ? 0 : Math.round((actual / planned) * 100);
}

export function rankPlanningPriorities(
    chapters: readonly ChapterSignal[],
    phase: PlanningPhase,
): PlanningPriority[] {
    return chapters
        .filter((chapter) => chapter.status !== 'REVISED')
        .map((chapter) => {
            const unfinished = chapter.status === 'NOT_STARTED';
            const revisionDue = phase !== 'COVERAGE' && chapter.status === 'DONE';
            const reason: PlanningPriority['reason'] = unfinished
                ? 'NOT_STARTED'
                : revisionDue
                    ? 'REVISION_DUE'
                    : chapter.status === 'IN_PROGRESS'
                        ? 'IN_PROGRESS'
                        : chapter.weightage >= 1.5
                            ? 'HIGH_WEIGHTAGE'
                            : 'IN_PROGRESS';
            const score =
                (unfinished ? 5 : 0) +
                (chapter.status === 'IN_PROGRESS' ? 3 : 0) +
                (revisionDue ? 4 : 0) +
                Math.max(0, chapter.weightage) * 2 +
                Math.min(3, chapter.estimatedStudyHours / 10);
            return { id: chapter.id, name: chapter.name, subjectId: chapter.subjectId, reason, score };
        })
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function recommendedDailyMinutes(
    baseMinutes: number,
    timeDebt: number,
    wellbeingScore: number | null,
): number {
    const recoveryCap = wellbeingScore !== null && wellbeingScore <= 2 ? 30 : 60;
    const catchUp = Math.min(Math.max(0, timeDebt), recoveryCap);
    return Math.max(30, Math.round(baseMinutes + catchUp));
}

export function windDownStart(now: Date, bedtime: string, windDownMin: number): Date | null {
    const match = /^(\d{2}):(\d{2})$/.exec(bedtime);
    if (!match) return null;
    const result = new Date(now);
    result.setHours(Number(match[1]), Number(match[2]), 0, 0);
    result.setMinutes(result.getMinutes() - Math.max(0, windDownMin));
    return result;
}
