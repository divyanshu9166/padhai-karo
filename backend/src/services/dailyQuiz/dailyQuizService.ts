/**
 * Daily Quiz — a 10-question previous-year-question drill that changes every India day.
 *
 *   GET  /api/daily-quiz         -> 200 { quizDate, available, questions, completed?, streak }
 *   POST /api/daily-quiz/submit  { questionIds, answers } -> 201 { result, streak }
 *                                -> 409 already submitted today / quiz changed
 *
 * Selection is deterministic per (user, India date): a hash-seeded shuffle of the student's
 * practice-eligible PYQs (their exam program/stage, not flagged, exactly four options),
 * preferring questions they have not seen in a daily quiz during the last 30 days. Because
 * it is recomputed rather than stored, every device sees the same quiz all day and the
 * answer key never has to leave the server before submission.
 *
 * Wrong answers become revision cards so the quiz feeds straight into spaced repetition.
 * The streak counts consecutive India days with a submitted quiz; it stays alive until the
 * end of today even if today's quiz is not done yet.
 */
import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

export const DAILY_QUIZ_SIZE = 10;
const RECENT_EXCLUSION_DAYS = 30;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** India calendar date (Asia/Kolkata, UTC+05:30, no DST) as `YYYY-MM-DD`. */
export function indiaDateKey(now: Date): string {
    return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Shift a `YYYY-MM-DD` India date key by whole days. */
export function shiftDateKey(key: string, days: number): string {
    return new Date(Date.parse(`${key}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Deterministic shuffle: order ids by sha256(seed + id). Stable for the same seed. */
export function seededOrder(ids: readonly string[], seed: string): string[] {
    return ids
        .map((id) => ({ id, key: createHash('sha256').update(`${seed}:${id}`).digest('hex') }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((entry) => entry.id);
}

/** Pick today's questions, preferring ones not used in the recent window. */
export function pickDailyQuestions(eligibleIds: readonly string[], recentlyUsed: ReadonlySet<string>, seed: string, size = DAILY_QUIZ_SIZE): string[] {
    const ordered = seededOrder(eligibleIds, seed);
    const fresh = ordered.filter((id) => !recentlyUsed.has(id));
    const repeat = ordered.filter((id) => recentlyUsed.has(id));
    return [...fresh, ...repeat].slice(0, size);
}

/**
 * Current streak from the set of India dates with a completed quiz. Counting starts today
 * when today is done, otherwise yesterday (the streak is still alive until midnight).
 */
export function computeQuizStreak(completedDates: ReadonlySet<string>, todayKey: string): { current: number; doneToday: boolean } {
    const doneToday = completedDates.has(todayKey);
    let cursor = doneToday ? todayKey : shiftDateKey(todayKey, -1);
    let current = 0;
    while (completedDates.has(cursor)) {
        current += 1;
        cursor = shiftDateKey(cursor, -1);
    }
    return { current, doneToday };
}

type QuizQuestion = { id: string; questionText: string; options: string[]; correctOption: number; year: number; subjectId: string };

async function loadScope(userId: string) {
    return prisma.profile.findUnique({ where: { userId }, select: { examTrack: true, examProgram: true, examStage: true } });
}

function scopeWhere(profile: NonNullable<Awaited<ReturnType<typeof loadScope>>>): Prisma.PYQWhereInput {
    return {
        examTrack: profile.examTrack,
        ...(profile.examProgram ? { examProgram: profile.examProgram } : {}),
        ...(profile.examStage ? { examStage: profile.examStage } : {}),
        flaggedForReview: false,
    };
}

async function todaysQuestions(userId: string, profile: NonNullable<Awaited<ReturnType<typeof loadScope>>>, todayKey: string): Promise<QuizQuestion[]> {
    const pool = await prisma.pYQ.findMany({ where: scopeWhere(profile), select: { id: true, options: true, correctOption: true } });
    const eligible = pool.filter((row) => row.options.length === 4 && row.correctOption >= 0 && row.correctOption <= 3).map((row) => row.id);
    if (eligible.length === 0) return [];

    const since = shiftDateKey(todayKey, -RECENT_EXCLUSION_DAYS);
    const recent = await prisma.dailyQuizAttempt.findMany({
        where: { userId, quizDate: { gte: since, lt: todayKey } },
        select: { questionIds: true },
    });
    const ids = pickDailyQuestions(eligible, new Set(recent.flatMap((row) => row.questionIds)), `${userId}:${todayKey}`);

    const rows = await prisma.pYQ.findMany({
        where: { id: { in: ids } },
        select: { id: true, questionText: true, options: true, correctOption: true, year: true, subjectId: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

async function streakFor(userId: string, todayKey: string) {
    // A streak can only be as long as the rows we load; a year is far beyond typical runs.
    const rows = await prisma.dailyQuizAttempt.findMany({
        where: { userId, quizDate: { gte: shiftDateKey(todayKey, -366), lte: todayKey } },
        select: { quizDate: true },
    });
    return computeQuizStreak(new Set(rows.map((row) => row.quizDate)), todayKey);
}

function review(questions: QuizQuestion[], answers: Record<string, number | null>) {
    return questions.map((question) => {
        const selected = answers[question.id] ?? null;
        return {
            id: question.id,
            questionText: question.questionText,
            options: question.options,
            year: question.year,
            subjectId: question.subjectId,
            selectedOption: selected,
            correctOption: question.correctOption,
            outcome: selected === null ? 'UNANSWERED' : selected === question.correctOption ? 'CORRECT' : 'INCORRECT',
        };
    });
}

export async function getDailyQuizHandler(_request: Request, auth: AuthContext, now: Date = new Date()): Promise<Response> {
    const userId = auth.user.id;
    const profile = await loadScope(userId);
    if (!profile) return errorResponse(404, ErrorCode.NOT_FOUND, 'Complete onboarding to get your daily quiz.');

    const quizDate = indiaDateKey(now);
    const [attempt, streak] = await Promise.all([
        prisma.dailyQuizAttempt.findUnique({ where: { userId_quizDate: { userId, quizDate } } }),
        streakFor(userId, quizDate),
    ]);

    if (attempt) {
        const rows = await prisma.pYQ.findMany({
            where: { id: { in: attempt.questionIds } },
            select: { id: true, questionText: true, options: true, correctOption: true, year: true, subjectId: true },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const questions = attempt.questionIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
        return Response.json({
            quizDate,
            available: true,
            questions: [],
            completed: { correctCount: attempt.correctCount, totalCount: attempt.totalCount, review: review(questions, attempt.answers as Record<string, number | null>) },
            streak,
        });
    }

    const questions = await todaysQuestions(userId, profile, quizDate);
    return Response.json({
        quizDate,
        available: questions.length > 0,
        // The answer key stays on the server until the quiz is submitted.
        questions: questions.map(({ id, questionText, options, year, subjectId }) => ({ id, questionText, options, year, subjectId })),
        completed: null,
        streak,
    });
}

function parseSubmission(body: unknown): { questionIds: string[]; answers: Record<string, number | null> } | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const { questionIds, answers } = body as Record<string, unknown>;
    if (!Array.isArray(questionIds) || questionIds.length === 0 || questionIds.length > DAILY_QUIZ_SIZE || !questionIds.every((id) => typeof id === 'string')) return null;
    if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) return null;
    const normalized: Record<string, number | null> = {};
    for (const id of questionIds as string[]) {
        const value = (answers as Record<string, unknown>)[id];
        if (value === undefined || value === null) normalized[id] = null;
        else if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3) normalized[id] = value;
        else return null;
    }
    return { questionIds: questionIds as string[], answers: normalized };
}

export async function submitDailyQuizHandler(request: Request, auth: AuthContext, now: Date = new Date()): Promise<Response> {
    const userId = auth.user.id;
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    const submission = parseSubmission(body);
    if (!submission) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, `Submit questionIds (1-${DAILY_QUIZ_SIZE}) and answers as option indexes 0-3 or null.`);
    }

    const profile = await loadScope(userId);
    if (!profile) return errorResponse(404, ErrorCode.NOT_FOUND, 'Complete onboarding to get your daily quiz.');

    const quizDate = indiaDateKey(now);
    const questions = await todaysQuestions(userId, profile, quizDate);
    const expected = questions.map((question) => question.id);
    if (expected.length !== submission.questionIds.length || expected.some((id, index) => id !== submission.questionIds[index])) {
        return errorResponse(409, ErrorCode.CONFLICT, "Today's quiz has changed. Reload it and try again.");
    }

    const graded = review(questions, submission.answers);
    const correctCount = graded.filter((item) => item.outcome === 'CORRECT').length;

    const missed = graded.filter((item) => item.outcome !== 'CORRECT');
    try {
        // A batch transaction: the attempt and its revision cards commit together, and the
        // (userId, quizDate) unique key rejects a second submission for the same day.
        await prisma.$transaction([
            prisma.dailyQuizAttempt.create({
                data: { userId, quizDate, questionIds: expected, answers: submission.answers as Prisma.InputJsonValue, correctCount, totalCount: expected.length },
            }),
            ...(missed.length === 0 ? [] : [
                prisma.revisionCard.createMany({
                    data: missed.map((item) => ({
                        userId,
                        title: `Daily quiz · PYQ ${item.year}`,
                        prompt: `${item.questionText}\n\n${item.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n')}`,
                        answer: `${String.fromCharCode(65 + item.correctOption)}. ${item.options[item.correctOption]}`,
                        sourceType: 'DAILY_QUIZ',
                        sourceId: item.id,
                        tags: ['daily-quiz', 'pyq'],
                        dueAt: new Date(now.getTime() + DAY_MS),
                    })),
                }),
            ]),
        ]);
    } catch (error) {
        if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002') {
            return errorResponse(409, ErrorCode.CONFLICT, "You have already completed today's quiz.");
        }
        throw error;
    }

    const streak = await streakFor(userId, quizDate);
    return Response.json({ result: { quizDate, correctCount, totalCount: expected.length, review: graded }, streak }, { status: 201 });
}
