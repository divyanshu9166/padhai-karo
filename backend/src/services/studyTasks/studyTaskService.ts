import type { StudyTaskPriority, StudyTaskStatus, StudyTaskType } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { startOfUtcDay } from '@/services/dashboard';

const TASK_TYPES = new Set<StudyTaskType>([
    'READING', 'NOTES_MAKING', 'REVISION', 'PYQ_PRACTICE', 'ANSWER_WRITING',
    'MOCK_TEST', 'MOCK_ANALYSIS', 'CURRENT_AFFAIRS', 'QUANT_PRACTICE',
    'REASONING_PRACTICE', 'VOCABULARY', 'FORMULA_REVISION',
]);
const PRIORITIES = new Set<StudyTaskPriority>(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
const STATUSES = new Set<StudyTaskStatus>(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'MISSED']);

const taskSelect = {
    id: true, title: true, syllabusUnit: true, subjectId: true, chapterId: true,
    examProgram: true, examStage: true, taskType: true, plannedMinutes: true,
    scheduledDate: true, priority: true, status: true, source: true, completedAt: true,
    studyBlockId: true, createdAt: true, updatedAt: true,
} as const;

function parseBodyDate(value: unknown, field: string, allowNull = false): Date | null | Response {
    if ((value === null || value === undefined || value === '') && allowNull) return null;
    if (typeof value !== 'string' || !value.trim()) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, `${field} must be an ISO date.`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, `${field} must be a valid date.`);
    }
    return startOfUtcDay(parsed);
}

function isResponse(value: unknown): value is Response {
    return value instanceof Response;
}

function readString(value: unknown, field: string, required = false): string | null | Response {
    if (value === null || value === undefined) return required
        ? errorResponse(422, ErrorCode.VALIDATION_ERROR, `${field} is required.`)
        : null;
    if (typeof value !== 'string') return errorResponse(422, ErrorCode.VALIDATION_ERROR, `${field} must be text.`);
    const result = value.trim();
    if (required && !result) return errorResponse(422, ErrorCode.VALIDATION_ERROR, `${field} is required.`);
    return result || null;
}

function startOfNextUtcDay(now = new Date()): Date {
    return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);
}

function taskTypeForSession(sessionType: string): StudyTaskType {
    switch (sessionType) {
        case 'NOTES_MAKING': return 'NOTES_MAKING';
        case 'REVISION': return 'REVISION';
        case 'PRACTICE_PROBLEMS': return 'PYQ_PRACTICE';
        case 'ANSWER_WRITING': return 'ANSWER_WRITING';
        case 'MOCK_TEST': return 'MOCK_TEST';
        case 'MOCK_ANALYSIS': return 'MOCK_ANALYSIS';
        case 'CURRENT_AFFAIRS': return 'CURRENT_AFFAIRS';
        case 'QUANT_PRACTICE': return 'QUANT_PRACTICE';
        case 'REASONING_PRACTICE': return 'REASONING_PRACTICE';
        case 'VOCABULARY': return 'VOCABULARY';
        case 'FORMULA_DRILL': return 'FORMULA_REVISION';
        default: return 'READING';
    }
}

/** Read a date range of actionable tasks. Unscheduled records are the learner's Inbox. */
export async function listStudyTasksHandler(request: Request, auth: AuthContext): Promise<Response> {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const includeInbox = url.searchParams.get('includeInbox') === 'true';
    const where: Record<string, unknown> = { userId: auth.user.id };
    if (from || to) {
        const date: Record<string, Date> = {};
        if (from) {
            const parsed = parseBodyDate(from, 'from');
            if (isResponse(parsed)) return parsed;
            date.gte = parsed as Date;
        }
        if (to) {
            const parsed = parseBodyDate(to, 'to');
            if (isResponse(parsed)) return parsed;
            date.lt = new Date((parsed as Date).getTime() + 24 * 60 * 60 * 1000);
        }
        if (includeInbox) where.OR = [{ scheduledDate: date }, { scheduledDate: null }];
        else where.scheduledDate = date;
    } else if (!includeInbox) {
        where.scheduledDate = { not: null };
    }
    const tasks = await prisma.studyTask.findMany({
        where,
        select: taskSelect,
        orderBy: [{ scheduledDate: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
        take: 250,
    });
    return Response.json({ tasks });
}

/** Quick capture and manual task creation. Planner/revision source values remain server-owned. */
export async function createStudyTaskHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const title = readString(input.title, 'title', true);
    if (isResponse(title)) return title;
    const syllabusUnit = readString(input.syllabusUnit, 'syllabusUnit');
    if (isResponse(syllabusUnit)) return syllabusUnit;
    const scheduledDate = parseBodyDate(input.scheduledDate, 'scheduledDate', true);
    if (isResponse(scheduledDate)) return scheduledDate;
    const plannedMinutes = typeof input.plannedMinutes === 'number' ? Math.round(input.plannedMinutes) : 30;
    if (!Number.isInteger(plannedMinutes) || plannedMinutes < 5 || plannedMinutes > 720) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'plannedMinutes must be between 5 and 720.');
    }
    const taskType = typeof input.taskType === 'string' ? input.taskType as StudyTaskType : 'READING';
    const priority = typeof input.priority === 'string' ? input.priority as StudyTaskPriority : 'NORMAL';
    if (!TASK_TYPES.has(taskType) || !PRIORITIES.has(priority)) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'taskType or priority is invalid.');
    }
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true } });
    const task = await prisma.studyTask.create({
        data: {
            userId: auth.user.id, title: title as string, syllabusUnit: syllabusUnit as string | null,
            subjectId: typeof input.subjectId === 'string' ? input.subjectId : null,
            chapterId: typeof input.chapterId === 'string' ? input.chapterId : null,
            taskType, plannedMinutes, scheduledDate: scheduledDate as Date | null, priority,
            source: input.quickCapture === true ? 'QUICK_CAPTURE' : 'MANUAL',
            examProgram: profile?.examProgram, examStage: profile?.examStage,
        },
        select: taskSelect,
    });
    return Response.json({ task }, { status: 201 });
}

/** Update task scheduling/state. A completed task is never automatically reopened by rescheduling. */
export async function updateStudyTaskHandler(request: Request, auth: AuthContext, id: string): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const existing = await prisma.studyTask.findFirst({ where: { id, userId: auth.user.id }, select: { id: true } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Study task not found.');
    const data: Record<string, unknown> = {};
    if ('title' in input) {
        const title = readString(input.title, 'title', true);
        if (isResponse(title)) return title;
        data.title = title;
    }
    if ('scheduledDate' in input) {
        const date = parseBodyDate(input.scheduledDate, 'scheduledDate', true);
        if (isResponse(date)) return date;
        data.scheduledDate = date;
    }
    if ('plannedMinutes' in input) {
        const plannedMinutes = typeof input.plannedMinutes === 'number' ? Math.round(input.plannedMinutes) : 0;
        if (!Number.isInteger(plannedMinutes) || plannedMinutes < 5 || plannedMinutes > 720) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'plannedMinutes must be between 5 and 720.');
        data.plannedMinutes = plannedMinutes;
    }
    if ('priority' in input) {
        if (typeof input.priority !== 'string' || !PRIORITIES.has(input.priority as StudyTaskPriority)) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'priority is invalid.');
        data.priority = input.priority;
    }
    if ('status' in input) {
        if (typeof input.status !== 'string' || !STATUSES.has(input.status as StudyTaskStatus)) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'status is invalid.');
        data.status = input.status;
        data.completedAt = input.status === 'COMPLETED' ? new Date() : null;
    }
    const task = await prisma.studyTask.update({ where: { id }, data, select: taskSelect });
    return Response.json({ task });
}

/** The action-first payload for the Today command center. */
export async function getTodayHandler(_request: Request, auth: AuthContext, now = new Date()): Promise<Response> {
    const today = startOfUtcDay(now);
    const tomorrow = startOfNextUtcDay(now);
    const [profile, tasks, revisionDue, focus, backlog, upcomingExam] = await Promise.all([
        prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true, targetExamDate: true } }),
        prisma.studyTask.findMany({ where: { userId: auth.user.id, scheduledDate: { gte: today, lt: tomorrow } }, select: taskSelect, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] }),
        prisma.revisionCard.count({ where: { userId: auth.user.id, suspended: false, dueAt: { lte: tomorrow } } }),
        prisma.focusSession.aggregate({ where: { userId: auth.user.id, startTime: { gte: today, lt: tomorrow } }, _sum: { focusedDurationMin: true } }),
        prisma.studyTask.count({ where: { userId: auth.user.id, status: { in: ['PENDING', 'IN_PROGRESS', 'MISSED'] }, scheduledDate: { lt: today } } }),
        prisma.examDate.findFirst({ where: { userId: auth.user.id, examDate: { gte: today } }, orderBy: [{ examDate: 'asc' }, { priority: 'desc' }], select: { examDate: true } }),
    ]);
    const currentAffairs = await prisma.currentAffairsItem.findFirst({
        where: profile?.examProgram ? { OR: [{ examProgram: null }, { examProgram: profile.examProgram }] } : {},
        orderBy: { publishedAt: 'desc' },
        select: { id: true, title: true, category: true, syllabusTags: true, prelimsRelevance: true, mainsRelevance: true },
    });
    const completed = tasks.filter((task) => task.status === 'COMPLETED').length;
    // Planner lets learners add concrete stage/session dates separately from onboarding's
    // target date. Prefer the nearest upcoming saved date so Today never says “set your date”
    // after the learner already added one in Plan.
    const targetDate = upcomingExam?.examDate ?? profile?.targetExamDate;
    const countdownDays = targetDate ? Math.max(0, Math.ceil((startOfUtcDay(targetDate).getTime() - today.getTime()) / 86_400_000)) : null;
    return Response.json({
        profile: profile ? { examProgram: profile.examProgram, examStage: profile.examStage } : null,
        countdownDays,
        tasks,
        progress: { completed, total: tasks.length, focusedMinutes: focus._sum.focusedDurationMin ?? 0 },
        revisionDue,
        currentAffairs,
        backlogCount: backlog,
    });
}

/** Redistribute overdue tasks into a realistic 3/7-day catch-up window or return low-priority work to Inbox. */
export async function rescueBacklogHandler(request: Request, auth: AuthContext, now = new Date()): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const days = input.days === 3 || input.days === 7 ? input.days : null;
    const reduceWorkload = input.mode === 'REDUCE_WORKLOAD';
    if (!days && !reduceWorkload) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Choose a 3-day, 7-day, or reduce-workload rescue option.');
    const today = startOfUtcDay(now);
    const overdue = await prisma.studyTask.findMany({
        where: { userId: auth.user.id, status: { in: ['PENDING', 'IN_PROGRESS', 'MISSED'] }, scheduledDate: { lt: today } },
        orderBy: [{ priority: 'desc' }, { scheduledDate: 'asc' }],
        select: { id: true, plannedMinutes: true, priority: true },
    });
    const inbox = reduceWorkload ? overdue.filter((task) => task.priority === 'LOW' || task.priority === 'NORMAL') : [];
    const recover = overdue.filter((task) => !inbox.some((candidate) => candidate.id === task.id));
    const recoveryDays = days ?? 7;
    const totalMinutes = recover.reduce((sum, task) => sum + task.plannedMinutes, 0);
    await prisma.$transaction([
        ...inbox.map((task) => prisma.studyTask.update({ where: { id: task.id }, data: { scheduledDate: null, status: 'PENDING' } })),
        ...recover.map((task, index) => prisma.studyTask.update({ where: { id: task.id }, data: { scheduledDate: new Date(today.getTime() + (index % recoveryDays) * 86_400_000), status: 'PENDING' } })),
    ]);
    return Response.json({ rescued: recover.length, movedToInbox: inbox.length, days: recoveryDays, dailyMinutes: Math.ceil(totalMinutes / recoveryDays) });
}

/** Sunday-friendly weekly review based on completed tasks, focus, revision, and practice. */
export async function getWeeklyReviewHandler(request: Request, auth: AuthContext, now = new Date()): Promise<Response> {
    const dateParam = new URL(request.url).searchParams.get('date');
    const anchor = dateParam ? new Date(dateParam) : now;
    if (Number.isNaN(anchor.getTime())) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'date must be valid.');
    const day = startOfUtcDay(anchor);
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    const start = new Date(day.getTime() - mondayOffset * 86_400_000);
    const end = new Date(start.getTime() + 7 * 86_400_000);
    const [tasks, sessions, revisions, attempts, mistakes] = await Promise.all([
        prisma.studyTask.findMany({ where: { userId: auth.user.id, scheduledDate: { gte: start, lt: end } }, select: { status: true, plannedMinutes: true, subjectId: true } }),
        prisma.focusSession.findMany({ where: { userId: auth.user.id, startTime: { gte: start, lt: end } }, select: { focusedDurationMin: true, startTime: true } }),
        prisma.revisionReview.count({ where: { userId: auth.user.id, reviewedAt: { gte: start, lt: end } } }),
        prisma.pYQAttempt.findMany({ where: { userId: auth.user.id, createdAt: { gte: start, lt: end } }, select: { perQuestion: true } }),
        prisma.mistakeJournalEntry.groupBy({ by: ['subjectId'], where: { userId: auth.user.id, createdAt: { gte: start, lt: end } }, _count: { _all: true }, orderBy: { _count: { subjectId: 'desc' } }, take: 1 }),
    ]);
    let questions = 0;
    let correct = 0;
    for (const attempt of attempts) {
        const answers = Array.isArray(attempt.perQuestion) ? attempt.perQuestion as Array<{ outcome?: unknown }> : [];
        questions += answers.length;
        correct += answers.filter((entry) => entry.outcome === 'CORRECT').length;
    }
    const activeDays = new Set(sessions.map((item) => startOfUtcDay(item.startTime).toISOString()));
    const completed = tasks.filter((task) => task.status === 'COMPLETED').length;
    const missed = tasks.filter((task) => task.status === 'MISSED').length;
    const focusedMinutes = sessions.reduce((sum, item) => sum + item.focusedDurationMin, 0);
    return Response.json({
        range: { start, end },
        focusedMinutes, consistencyDays: activeDays.size,
        plan: { completed, total: tasks.length, missed, completionPercent: tasks.length ? Math.round(completed / tasks.length * 100) : 0 },
        revisionCompleted: revisions,
        practice: { questions, accuracyPercent: questions ? Math.round(correct / questions * 100) : null },
        biggestWeakness: mistakes[0]?.subjectId ?? null,
    });
}

export { taskTypeForSession };
