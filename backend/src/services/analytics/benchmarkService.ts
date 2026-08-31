import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

function percentile(sorted: number[], value: number): number { if (sorted.length === 0) return 0; const rank = sorted.filter((item) => item <= value).length; return Math.round((rank / sorted.length) * 100); }

export async function getAnonymousBenchmarkHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true } });
    if (!profile?.examProgram) return errorResponse(404, ErrorCode.NOT_FOUND, 'Complete UPSC/SSC onboarding first.');
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [cohort, sessions] = await Promise.all([
        prisma.profile.findMany({ where: { examProgram: profile.examProgram, ...(profile.examStage ? { examStage: profile.examStage } : {}) }, select: { userId: true } }),
        prisma.focusSession.findMany({ where: { startTime: { gte: since } }, select: { userId: true, focusedDurationMin: true } }),
    ]);
    const cohortIds = new Set(cohort.map((item) => item.userId));
    const totals = new Map<string, number>();
    for (const session of sessions) if (cohortIds.has(session.userId)) totals.set(session.userId, (totals.get(session.userId) ?? 0) + session.focusedDurationMin);
    const values = [...cohortIds].map((id) => totals.get(id) ?? 0).sort((a, b) => a - b);
    const userMinutes = totals.get(auth.user.id) ?? 0;
    const median = values.length === 0 ? 0 : values[Math.floor(values.length / 2)] ?? 0;
    return Response.json({ benchmark: { program: profile.examProgram, stage: profile.examStage ?? null, cohortSize: values.length, userMinutes, cohortMedianMinutes: median, percentile: percentile(values, userMinutes), anonymous: true } });
}
