import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { getExamGuidance, getExamGuidanceCatalog, simulateStrategy } from '@/lib/upscc';

export async function getGuidanceHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true } });
    if (!profile?.examProgram || !profile.examStage) return errorResponse(404, ErrorCode.NOT_FOUND, 'Complete UPSC/SSC onboarding first.');
    return Response.json({ guidance: getExamGuidance(profile.examProgram, profile.examStage) });
}

export async function getGuidanceCatalogHandler(): Promise<Response> { return Response.json({ guidance: getExamGuidanceCatalog() }); }

export async function simulateStrategyHandler(request: Request): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const questionCount = typeof input.questionCount === 'number' ? input.questionCount : NaN;
    const totalTimeSec = typeof input.totalTimeSec === 'number' ? input.totalTimeSec : NaN;
    const targetAttempted = typeof input.targetAttempted === 'number' ? input.targetAttempted : NaN;
    if (!Number.isFinite(questionCount) || !Number.isFinite(totalTimeSec) || !Number.isFinite(targetAttempted) || questionCount <= 0 || totalTimeSec <= 0 || targetAttempted < 0 || targetAttempted > questionCount) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'questionCount, totalTimeSec and targetAttempted must be valid.');
    return Response.json({ simulation: simulateStrategy({ questionCount, totalTimeSec, targetAttempted, averageReadSec: typeof input.averageReadSec === 'number' ? input.averageReadSec : undefined, reviewSec: typeof input.reviewSec === 'number' ? input.reviewSec : undefined }) });
}

export async function getAmbientModesHandler(): Promise<Response> {
    // These are CC BY 4.0 sounds from Google's official sound library. Environment values
    // still override them so production can serve pinned, locally cached audio assets.
    const rainUrl = process.env.AMBIENT_RAIN_URL?.trim() || 'https://actions.google.com/sounds/v1/ambiences/outside_night.ogg';
    const humUrl = process.env.AMBIENT_BROWN_NOISE_URL?.trim() || 'https://actions.google.com/sounds/v1/ambiences/ambient_hum_air_conditioner.ogg';
    return Response.json({ modes: [
        { id: 'rain', label: 'Night ambience', url: rainUrl, loop: true },
        { id: 'brown-noise', label: 'Ambient hum', url: humUrl, loop: true },
        { id: 'silence', label: 'Silence', url: null, loop: false },
    ] });
}

export async function getWidgetSummaryHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const [profile, todayMinutes, pending] = await Promise.all([
        prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true, targetExamDate: true } }),
        prisma.focusSession.aggregate({ where: { userId: auth.user.id, startTime: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } }, _sum: { focusedDurationMin: true } }),
        prisma.chapter.count({ where: { userId: auth.user.id, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } } }),
    ]);
    return Response.json({ widget: { examProgram: profile?.examProgram ?? null, examStage: profile?.examStage ?? null, todayMinutes: todayMinutes._sum.focusedDurationMin ?? 0, pendingTopics: pending, targetExamDate: profile?.targetExamDate ?? null } });
}
