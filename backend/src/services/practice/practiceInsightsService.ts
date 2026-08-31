import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { getWeakAreaResult } from '@/services/analytics/weakAreaService';

interface PerQuestionRow { outcome?: string; questionId?: string; selectedOption?: string | null; }

function rows(value: unknown): PerQuestionRow[] {
    return Array.isArray(value) ? value.filter((item): item is PerQuestionRow => item !== null && typeof item === 'object') : [];
}

export async function getPracticeInsightsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const [pyqAttempts, timedAttempts, weakAreas] = await Promise.all([
        prisma.pYQAttempt.findMany({ where: { userId: auth.user.id }, select: { id: true, totalScore: true, perQuestion: true, createdAt: true } }),
        prisma.timedPaperAttempt.findMany({ where: { userId: auth.user.id }, select: { id: true, paperId: true, totalScore: true, timeTakenSec: true, perQuestion: true, createdAt: true } }),
        getWeakAreaResult(auth.user.id),
    ]);
    const allAttempts = [...pyqAttempts.map((attempt) => ({ ...attempt, mode: 'PYQ', timeTakenSec: null })), ...timedAttempts.map((attempt) => ({ ...attempt, mode: 'TIMED' }))]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const questionRows = allAttempts.flatMap((attempt) => rows(attempt.perQuestion));
    const correct = questionRows.filter((row) => row.outcome === 'CORRECT').length;
    const incorrect = questionRows.filter((row) => row.outcome === 'INCORRECT').length;
    const unanswered = questionRows.filter((row) => row.outcome === 'UNANSWERED').length;
    const timed = timedAttempts.filter((attempt) => attempt.timeTakenSec > 0);
    const avgTimeSec = timed.length === 0 ? null : Math.round(timed.reduce((sum, attempt) => sum + attempt.timeTakenSec, 0) / timed.length);
    const accuracy = correct + incorrect === 0 ? 0 : Math.round((correct / (correct + incorrect)) * 100);
    const program = (await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true } }));
    const strategy = program?.examStage === 'MAINS'
        ? ['Start with the question where you have the clearest structure.', 'Use a short introduction, subheadings and a conclusion.', 'Reserve the last 10 minutes for review and missing dimensions.']
        : program?.examProgram === 'SSC_CGL'
            ? ['Use a two-pass attempt: sure questions first, flagged questions second.', 'Track section time instead of spending too long on one question.', 'Review only marked questions in the final pass.']
            : ['Use a two-pass attempt: sure questions first, flagged questions second.', 'Keep a short error log after every paper.', 'Use the next session to revise the top two weak areas.'];
    return Response.json({
        summary: { totalAttempts: allAttempts.length, correct, incorrect, unanswered, accuracyPercent: accuracy, averageTimedSeconds: avgTimeSec },
        attempts: allAttempts.slice(0, 20),
        weakAreas: weakAreas.weakAreas.slice(0, 10),
        sessionTypeDistribution: weakAreas.sessionTypeDistribution,
        strategy,
        exam: program,
    });
}

export async function createExternalMockScoreHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const obtainedScore = typeof input.obtainedScore === 'number' ? input.obtainedScore : NaN;
    const maxScore = typeof input.maxScore === 'number' ? input.maxScore : NaN;
    const testDate = typeof input.testDate === 'string' ? new Date(input.testDate) : new Date();
    if (!Number.isFinite(obtainedScore) || !Number.isFinite(maxScore) || maxScore <= 0 || obtainedScore < 0 || obtainedScore > maxScore || Number.isNaN(testDate.getTime()) || testDate > new Date()) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Provide a valid past testDate and a score between 0 and maxScore.');
    }
    const score = await prisma.externalMockScore.create({
        data: { userId: auth.user.id, source: 'OTHER', sourceName: typeof input.sourceName === 'string' && input.sourceName.trim() ? input.sourceName.trim() : 'Self reported', testDate, obtainedScore, maxScore },
    });
    return Response.json({ score }, { status: 201 });
}

export async function listExternalMockScoresHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const scores = await prisma.externalMockScore.findMany({ where: { userId: auth.user.id }, orderBy: { testDate: 'desc' }, take: 50 });
    return Response.json({ scores });
}
