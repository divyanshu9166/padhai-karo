import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import {
    computeAverageEfficiency,
    computeCountdownDays,
    computeStudyCredit,
    computeTimeDebt,
    determinePlanningPhase,
    rankPlanningPriorities,
    recommendedDailyMinutes,
} from '@/lib/planning';
import { getExamProgram } from '@/lib/exams';

const DAY = 86_400_000;

function dayStart(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function parseDate(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function readDateParam(request: Request): Date {
    const raw = new URL(request.url).searchParams.get('date');
    return raw ? parseDate(raw) ?? dayStart(new Date()) : dayStart(new Date());
}

export async function getPlanningOverviewHandler(request: Request, auth: AuthContext): Promise<Response> {
    const selectedDate = readDateParam(request);
    const from = new Date(selectedDate.getTime() - 6 * DAY);
    const to = new Date(selectedDate.getTime() + 8 * DAY);

    const [profile, examDates, chapters, audits, blocks, latestCheckin, sleepSchedule, dueCards, nextCards] = await Promise.all([
        prisma.profile.findUnique({
            where: { userId: auth.user.id },
            select: { examProgram: true, examStage: true, targetExamDate: true },
        }),
        prisma.examDate.findMany({
            where: { userId: auth.user.id },
            orderBy: [{ priority: 'desc' }, { examDate: 'asc' }],
            select: { id: true, label: true, examDate: true, examProgram: true, examStage: true, priority: true },
        }),
        prisma.chapter.findMany({
            where: { userId: auth.user.id },
            select: { id: true, name: true, status: true, weightage: true, estimatedStudyHours: true, subjectId: true },
        }),
        prisma.dailyTimeAudit.findMany({
            where: { userId: auth.user.id, date: { gte: from, lt: selectedDate } },
            orderBy: { date: 'asc' },
            select: { plannedMin: true, actualMin: true, date: true },
        }),
        prisma.studyBlock.findMany({
            where: { userId: auth.user.id, startTime: { gte: selectedDate, lt: to } },
            orderBy: { startTime: 'asc' },
            select: { id: true, timetableId: true, subjectId: true, chapterId: true, startTime: true, durationMin: true, isBuffer: true, energyLevel: true, scheduledOutsidePeak: true, sessionType: true, revisionNumber: true },
        }),
        prisma.wellbeingCheckin.findFirst({
            where: { userId: auth.user.id },
            orderBy: { checkinDate: 'desc' },
            select: { mood: true, energy: true, stress: true, sleepHours: true, checkinDate: true },
        }),
        prisma.sleepSchedule.findUnique({ where: { userId: auth.user.id } }),
        prisma.revisionCard.count({ where: { userId: auth.user.id, suspended: false, dueAt: { lte: selectedDate } } }),
        prisma.revisionCard.findMany({ where: { userId: auth.user.id, suspended: false }, orderBy: { dueAt: 'asc' }, take: 10, select: { id: true, title: true, dueAt: true, intervalDays: true, repetitions: true } }),
    ]);

    const nearestExam = examDates
        .filter((item) => item.examDate >= selectedDate)
        .sort((a, b) => a.examDate.getTime() - b.examDate.getTime() || b.priority - a.priority)[0]?.examDate
        ?? profile?.targetExamDate
        ?? null;
    const countdownDays = computeCountdownDays(nearestExam, selectedDate);
    const phase = determinePlanningPhase(countdownDays);
    const signals = audits.map(({ plannedMin, actualMin }) => ({ plannedMin, actualMin }));
    const timeDebtMin = computeTimeDebt(signals);
    const studyCreditMin = computeStudyCredit(signals);
    const wellbeingScore = latestCheckin
        ? Math.round((latestCheckin.mood + latestCheckin.energy + (6 - latestCheckin.stress)) / 3)
        : null;
    const baseMinutes = Math.max(60, Math.round(chapters.reduce((sum, chapter) => sum + chapter.estimatedStudyHours, 0) * 60 / Math.max(1, countdownDays ?? 30)));

    return Response.json({
        selectedDate,
        exam: {
            program: profile?.examProgram ?? null,
            stage: profile?.examStage ?? null,
            nearest: nearestExam,
            countdownDays,
            phase,
            dates: examDates,
        },
        time: {
            timeDebtMin,
            studyCreditMin,
            averageEfficiencyPercent: computeAverageEfficiency(signals),
            recommendedDailyMin: recommendedDailyMinutes(baseMinutes, timeDebtMin, wellbeingScore),
        },
        priorities: rankPlanningPriorities(chapters, phase).slice(0, 12),
        schedule: { blocks, sleepSchedule },
        revision: {
            dueCount: dueCards,
            nextCards,
            cycleIntervalsDays: [1, 3, 7, 21],
            cyclePlan: chapters.slice(0, 30).map((chapter) => ({
                chapterId: chapter.id,
                chapterName: chapter.name,
                cycles: [0, 1, 3, 7, 21].map((offset) => ({ offsetDays: offset, date: new Date(selectedDate.getTime() + offset * DAY).toISOString() })),
            })),
        },
        wellbeing: latestCheckin ? { ...latestCheckin, score: wellbeingScore } : null,
    });
}

export async function listExamDatesHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const dates = await prisma.examDate.findMany({
        where: { userId: auth.user.id },
        orderBy: [{ examDate: 'asc' }, { priority: 'desc' }],
    });
    return Response.json({ dates });
}

export async function createExamDateHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (body === null || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    const date = parseDate(input.examDate);
    if (!label || !date) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'label and a valid examDate are required.');
    if (typeof input.examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.examDate) && date.toISOString().slice(0, 10) !== input.examDate) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'examDate must be a real calendar date.');
    const priority = typeof input.priority === 'number' && Number.isInteger(input.priority) ? Math.max(0, Math.min(100, input.priority)) : 1;
    if (input.examProgram !== undefined && input.examProgram !== 'UPSC_CSE' && input.examProgram !== 'SSC_CGL') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'examProgram must be UPSC_CSE or SSC_CGL.');
    const program = input.examProgram === 'UPSC_CSE' || input.examProgram === 'SSC_CGL' ? input.examProgram : undefined;
    if (input.examStage !== undefined && typeof input.examStage !== 'string') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'examStage must be a string when provided.');
    const stage = typeof input.examStage === 'string' ? input.examStage.trim() : undefined;
    if (stage && (!program || !(getExamProgram(program).stages as readonly string[]).includes(stage))) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'examStage is not valid for the selected examProgram.');
    const created = await prisma.examDate.create({
        data: {
            userId: auth.user.id,
            label,
            examDate: date,
            priority,
            examProgram: program,
            examStage: stage as never,
        },
    });
    return Response.json({ date: created }, { status: 201 });
}

export interface ExamDateRouteContext { params: { id: string } | Promise<{ id: string }> }

export async function deleteExamDateHandler(_request: Request, auth: AuthContext, context: ExamDateRouteContext): Promise<Response> {
    const params = await context.params;
    const existing = await prisma.examDate.findFirst({ where: { id: params.id, userId: auth.user.id } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Exam date not found.');
    await prisma.examDate.delete({ where: { id: existing.id } });
    return new Response(null, { status: 204 });
}
