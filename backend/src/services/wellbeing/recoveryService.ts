import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { buildThreeDayRecoveryPlan, detectBurnoutRisk } from '@/lib/wellbeing/recovery';

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

export async function getWellbeingInsightsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const today = new Date(); const from = new Date(today); from.setUTCDate(from.getUTCDate() - 7);
    const [checkins, audits, sessions] = await Promise.all([
        prisma.wellbeingCheckin.findMany({ where: { userId: auth.user.id, checkinDate: { gte: from } }, orderBy: { checkinDate: 'asc' } }),
        prisma.dailyTimeAudit.findMany({ where: { userId: auth.user.id, date: { gte: from } } }),
        prisma.focusSession.findMany({ where: { userId: auth.user.id, startTime: { gte: from } }, select: { startTime: true, focusedDurationMin: true, abandoned: true } }),
    ]);
    const averageStress = checkins.length === 0 ? 3 : checkins.reduce((sum, row) => sum + row.stress, 0) / checkins.length;
    const averageEnergy = checkins.length === 0 ? 3 : checkins.reduce((sum, row) => sum + row.energy, 0) / checkins.length;
    const byDay = sessions.reduce<Record<string, number>>((acc, row) => { const key = row.startTime.toISOString().slice(0, 10); acc[key] = (acc[key] ?? 0) + row.focusedDurationMin; return acc; }, {});
    const heavyStudyDays = Object.values(byDay).filter((minutes) => minutes >= 480).length;
    const missedPlanDays = audits.filter((row) => row.plannedMin >= 120 && row.actualMin < row.plannedMin * 0.5).length;
    const abandonedSessions = sessions.filter((row) => row.abandoned).length;
    const signals = { averageStress, averageEnergy, heavyStudyDays, missedPlanDays, abandonedSessions };
    const risk = detectBurnoutRisk(signals);
    return Response.json({ risk, signals, checkins, recoveryPlan: risk === 'HIGH' ? buildThreeDayRecoveryPlan() : null });
}

export async function createRecoveryPlanHandler(request: Request, auth: AuthContext): Promise<Response> {
    let input: Record<string, unknown>; try { input = await request.json(); } catch { input = {}; }
    const reason = text(input.reason) || 'Burnout recovery';
    const startDate = new Date(); const endDate = new Date(startDate); endDate.setUTCDate(endDate.getUTCDate() + 2);
    const plan = buildThreeDayRecoveryPlan(startDate);
    const saved = await prisma.recoveryPlan.create({ data: { userId: auth.user.id, startDate, endDate, reason, dailyPlan: plan as unknown as Prisma.InputJsonValue } });
    return Response.json({ plan: saved }, { status: 201 });
}

export async function createAnxietyProtocolLogHandler(request: Request, auth: AuthContext): Promise<Response> {
    let input: Record<string, unknown>; try { input = await request.json(); } catch { input = {}; }
    const protocol = text(input.protocol) || 'BOX_BREATHING';
    const durationSec = typeof input.durationSec === 'number' ? Math.max(0, Math.floor(input.durationSec)) : undefined;
    const log = await prisma.anxietyProtocolLog.create({ data: { userId: auth.user.id, protocol, durationSec, completed: input.completed !== false } });
    return Response.json({ log, steps: protocol === 'GROUNDING_5_4_3_2_1' ? ['Name 5 things you see', '4 things you feel', '3 things you hear', '2 things you smell', '1 thing you taste'] : ['Inhale for 4 seconds', 'Hold for 4 seconds', 'Exhale for 4 seconds', 'Hold for 4 seconds', 'Repeat for 2 minutes'] }, { status: 201 });
}
