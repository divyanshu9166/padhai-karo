import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPlanningOverviewHandler } from '@/services/planning';
import { getWeakAreaResult } from '@/services/analytics/weakAreaService';
import { liveProviderConfigured, summarizeWithGemini } from '@/services/ai/liveProvider';
import { ErrorCode, errorResponse } from '@/lib/errors';

function today(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function object(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function savedInsights(existing: { priorities: unknown; schedule: unknown; wellbeing: unknown; insights: unknown }): Record<string, any> {
    const current = object(existing.insights);
    return {
        priorities: existing.priorities,
        schedule: existing.schedule,
        wellbeing: existing.wellbeing,
        greeting: 'Your saved daily briefing is ready.',
        actions: [],
        source: 'RULE_BASED',
        ...current,
    };
}

async function buildBriefing(userId: string, refresh: boolean): Promise<unknown> {
    const date = today();
    const auth = { user: { id: userId } } as Parameters<typeof getPlanningOverviewHandler>[1];
    const planningResponse = await getPlanningOverviewHandler(new Request(`http://localhost/api/planning/overview?date=${date.toISOString()}`), auth);
    const planning = await planningResponse.json() as Record<string, any>;
    const [weak, updates, checkin] = await Promise.all([
        getWeakAreaResult(userId),
        prisma.currentAffairsItem.findMany({ orderBy: { publishedAt: 'desc' }, take: 5, select: { id: true, title: true, summary: true, category: true, sourceUrl: true } }),
        prisma.wellbeingCheckin.findFirst({ where: { userId }, orderBy: { checkinDate: 'desc' }, select: { mood: true, energy: true, stress: true } }),
    ]);
    const priorities = Array.isArray(planning.priorities) ? planning.priorities.slice(0, 3) : [];
    const phase = planning.exam?.phase ?? 'COVERAGE';
    const countdownDays = planning.exam?.countdownDays ?? null;
    const wellbeingScore = checkin ? Math.round((checkin.mood + checkin.energy + (6 - checkin.stress)) / 3) : null;
    const schedule = Array.isArray(planning.schedule?.blocks) ? planning.schedule.blocks.filter((block: any) => String(block.startTime).slice(0, 10) === date.toISOString().slice(0, 10)).slice(0, 6) : [];
    const gentle = wellbeingScore !== null && wellbeingScore <= 2;
    const firstPriority = object(priorities[0]);
    const firstWeakArea = object(weak.weakAreas[0]);
    const actions = gentle
        ? ['Choose one high-value topic.', 'Use shorter blocks with real breaks.', 'Stop before exhaustion and protect sleep.']
        : [
            firstPriority.name ? `Start with ${firstPriority.name}.` : 'Complete the first priority block.',
            firstWeakArea.name ? `Review ${firstWeakArea.name} from your mistake journal.` : 'Review one mistake cluster.',
            schedule.length > 0 ? 'Protect the next scheduled block and end with a 5-minute audit.' : 'Plan one focused block and end the day with a 5-minute audit.',
        ];
    const content: Record<string, any> = {
        greeting: gentle ? 'Today is a recovery-aware study day. A small consistent step counts.' : 'You have a clear next step today. Start with one focused block.',
        priorities,
        schedule,
        weakAreas: weak.weakAreas.slice(0, 3),
        updates,
        wellbeing: checkin ? { ...checkin, score: wellbeingScore, mode: gentle ? 'RECOVERY' : 'NORMAL' } : null,
        actions,
        refresh,
        phase,
        countdownDays,
        source: 'RULE_BASED',
    };
    if (liveProviderConfigured()) {
        try {
            const ai = await summarizeWithGemini('Create a gentle, practical UPSC/SSC daily briefing from these signals. Return keyPoints as 3 actions and a short title. Signals: ' + JSON.stringify({ phase: content.phase, countdownDays: content.countdownDays, priorities, weakAreas: content.weakAreas, wellbeing: content.wellbeing, updates }));
            content.ai = ai;
            content.source = 'AI';
        } catch {
            content.ai = null;
        }
    }
    return { phase, countdownDays, priorities, schedule, insights: content, wellbeing: content.wellbeing };
}

export async function getDailyBriefingHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const briefingDate = today();
    const existing = await prisma.dailyBriefing.findUnique({ where: { userId_briefingDate: { userId: auth.user.id, briefingDate } } });
    if (existing) return Response.json({ briefing: { ...existing, insights: savedInsights(existing) } });
    const content = await buildBriefing(auth.user.id, false) as Record<string, any>;
    const briefing = await prisma.dailyBriefing.create({ data: { userId: auth.user.id, briefingDate, phase: content.phase, countdownDays: content.countdownDays, priorities: content.priorities as unknown as Prisma.InputJsonValue, schedule: content.schedule as unknown as Prisma.InputJsonValue, insights: content.insights as unknown as Prisma.InputJsonValue, wellbeing: content.wellbeing as unknown as Prisma.InputJsonValue } });
    return Response.json({ briefing });
}

export async function refreshDailyBriefingHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const briefingDate = today();
    const content = await buildBriefing(auth.user.id, true) as Record<string, any>;
    const briefing = await prisma.dailyBriefing.upsert({
        where: { userId_briefingDate: { userId: auth.user.id, briefingDate } },
        create: { userId: auth.user.id, briefingDate, phase: content.phase, countdownDays: content.countdownDays, priorities: content.priorities as unknown as Prisma.InputJsonValue, schedule: content.schedule as unknown as Prisma.InputJsonValue, insights: content.insights as unknown as Prisma.InputJsonValue, wellbeing: content.wellbeing as unknown as Prisma.InputJsonValue },
        update: { phase: content.phase, countdownDays: content.countdownDays, priorities: content.priorities as unknown as Prisma.InputJsonValue, schedule: content.schedule as unknown as Prisma.InputJsonValue, insights: content.insights as unknown as Prisma.InputJsonValue, wellbeing: content.wellbeing as unknown as Prisma.InputJsonValue, generatedAt: new Date() },
    });
    return Response.json({ briefing });
}

/** Generate today's briefing for every onboarded user. Used by the scheduler worker. */
export async function generateDailyBriefingsForUsers(): Promise<{ generated: number; failed: number }> {
    const users = await prisma.profile.findMany({ select: { userId: true } });
    let generated = 0; let failed = 0;
    for (const user of users) {
        try { await refreshDailyBriefingHandler(new Request('http://scheduler.local/api/briefing/daily', { method: 'POST' }), { user: { id: user.userId } } as AuthContext); generated += 1; }
        catch { failed += 1; }
    }
    return { generated, failed };
}

/** Deployment-cron handler for scheduled AI/rule-based daily briefings. */
export async function generateDailyBriefingsCronHandler(request: Request): Promise<Response> {
    const secret = process.env.BRIEFING_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
    const supplied = request.headers.get('x-briefing-cron-secret')?.trim() || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!secret || supplied !== secret) return errorResponse(403, ErrorCode.FORBIDDEN, 'A valid briefing cron secret is required.');
    return Response.json(await generateDailyBriefingsForUsers());
}
