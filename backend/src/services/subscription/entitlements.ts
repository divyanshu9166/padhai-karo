/**
 * AI-notes entitlements: who may generate a live-AI note right now, and how many remain.
 *
 *   - PAID  — the purchased `Profile.aiQuota` balance, decremented per produced note.
 *   - TRIAL — a one-time 7-day premium trial with {@link TRIAL_AI_LIMIT} notes in total.
 *   - FREE  — {@link FREE_WEEKLY_AI_LIMIT} notes per rolling 7 days, so every student can
 *             try AI notes before paying.
 *
 * FREE and TRIAL usage is counted from `AiUsageEvent` rows with outcome `PRODUCED` (the
 * same row the notes transaction already writes), so no separate counter can drift.
 * Local extractive notes (no AI provider call) never consume an allowance.
 */
import type { Prisma, PrismaClient, SubscriptionTier } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

export const FREE_WEEKLY_AI_LIMIT = 5;
export const TRIAL_DAYS = 7;
export const TRIAL_AI_LIMIT = 25;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface EntitlementProfile {
    subscriptionTier: SubscriptionTier;
    aiQuota: number;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
}

export type AiAllowance =
    | { plan: 'PAID'; remaining: number }
    | { plan: 'TRIAL'; remaining: number; limit: number; trialEndsAt: Date }
    | { plan: 'FREE'; remaining: number; limit: number; resetsAt: Date | null; trialAvailable: boolean };

type Db = PrismaClient | Prisma.TransactionClient;

export const ENTITLEMENT_PROFILE_SELECT = {
    subscriptionTier: true,
    aiQuota: true,
    trialStartedAt: true,
    trialEndsAt: true,
} as const;

export function isTrialActive(profile: Pick<EntitlementProfile, 'trialEndsAt'>, now: Date): boolean {
    return profile.trialEndsAt !== null && profile.trialEndsAt.getTime() > now.getTime();
}

export async function resolveAiAllowance(db: Db, userId: string, profile: EntitlementProfile, now = new Date()): Promise<AiAllowance> {
    if (profile.subscriptionTier === 'PAID') return { plan: 'PAID', remaining: Math.max(0, profile.aiQuota) };

    if (isTrialActive(profile, now) && profile.trialStartedAt) {
        const used = await db.aiUsageEvent.count({ where: { userId, outcome: 'PRODUCED', createdAt: { gte: profile.trialStartedAt } } });
        return { plan: 'TRIAL', remaining: Math.max(0, TRIAL_AI_LIMIT - used), limit: TRIAL_AI_LIMIT, trialEndsAt: profile.trialEndsAt! };
    }

    const windowStart = new Date(now.getTime() - WEEK_MS);
    const recent = await db.aiUsageEvent.findMany({
        where: { userId, outcome: 'PRODUCED', createdAt: { gte: windowStart } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
    });
    const remaining = Math.max(0, FREE_WEEKLY_AI_LIMIT - recent.length);
    // The oldest note in the window is the next one to roll off and free up a slot.
    const resetsAt = recent.length > 0 ? new Date(recent[0]!.createdAt.getTime() + WEEK_MS) : null;
    return { plan: 'FREE', remaining, limit: FREE_WEEKLY_AI_LIMIT, resetsAt, trialAvailable: profile.trialStartedAt === null };
}

/** The response returned when the allowance is used up. Paid users get 429, others 402. */
export function allowanceExhaustedResponse(allowance: AiAllowance): Response {
    if (allowance.plan === 'PAID') {
        return errorResponse(429, ErrorCode.QUOTA_EXCEEDED, 'Your AI usage quota has been exhausted.');
    }
    if (allowance.plan === 'TRIAL') {
        return errorResponse(402, ErrorCode.UPGRADE_REQUIRED, `You have used all ${allowance.limit} AI notes in your free trial. Upgrade to keep creating AI notes.`, serializeAllowance(allowance));
    }
    return errorResponse(
        402,
        ErrorCode.UPGRADE_REQUIRED,
        `You have used this week's ${allowance.limit} free AI notes.${allowance.trialAvailable ? ' Start your free 7-day trial or upgrade to continue.' : ' Upgrade to continue, or wait for your free notes to refresh.'}`,
        serializeAllowance(allowance),
    );
}

export function serializeAllowance(allowance: AiAllowance): Record<string, unknown> {
    switch (allowance.plan) {
        case 'PAID':
            return { plan: 'PAID', remaining: allowance.remaining };
        case 'TRIAL':
            return { plan: 'TRIAL', remaining: allowance.remaining, limit: allowance.limit, trialEndsAt: allowance.trialEndsAt.toISOString() };
        case 'FREE':
            return { plan: 'FREE', remaining: allowance.remaining, limit: allowance.limit, resetsAt: allowance.resetsAt?.toISOString() ?? null, trialAvailable: allowance.trialAvailable };
    }
}

/**
 * Consume one AI note inside the caller's transaction. Returns `false` when the allowance
 * ran out (including a concurrent request winning the last slot).
 *
 * PAID decrements the quota with a guarded update. FREE/TRIAL take a per-user advisory lock
 * so two simultaneous requests cannot both count the same final free slot; the caller then
 * writes the `PRODUCED` usage event that records the consumption.
 */
export async function claimAiAllowance(tx: Prisma.TransactionClient, userId: string, now = new Date()): Promise<boolean> {
    const profile = await tx.profile.findUnique({ where: { userId }, select: ENTITLEMENT_PROFILE_SELECT });
    if (!profile) return false;
    if (profile.subscriptionTier === 'PAID') {
        const claimed = await tx.profile.updateMany({ where: { userId, subscriptionTier: 'PAID', aiQuota: { gt: 0 } }, data: { aiQuota: { decrement: 1 } } });
        return claimed.count === 1;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-allowance:${userId}`}))`;
    const allowance = await resolveAiAllowance(tx, userId, profile, now);
    return allowance.remaining > 0;
}

/** Handle `POST /api/subscriptions/trial`: start the one-time 7-day premium trial. */
export async function startTrialHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const userId = auth.user.id;
    const profile = await prisma.profile.findUnique({ where: { userId }, select: ENTITLEMENT_PROFILE_SELECT });
    if (!profile) return errorResponse(404, ErrorCode.NOT_FOUND, 'Complete onboarding before starting a trial.');
    if (profile.subscriptionTier === 'PAID') return errorResponse(409, ErrorCode.CONFLICT, 'You already have a paid plan.');
    if (profile.trialStartedAt) return errorResponse(409, ErrorCode.CONFLICT, 'Your free trial has already been used.');

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    // Guarded on `trialStartedAt: null` so a double-tap cannot restart the trial.
    const started = await prisma.profile.updateMany({ where: { userId, trialStartedAt: null }, data: { trialStartedAt: now, trialEndsAt } });
    if (started.count !== 1) return errorResponse(409, ErrorCode.CONFLICT, 'Your free trial has already been used.');

    const allowance = await resolveAiAllowance(prisma, userId, { ...profile, trialStartedAt: now, trialEndsAt }, now);
    return Response.json({ trialEndsAt: trialEndsAt.toISOString(), aiAllowance: serializeAllowance(allowance) }, { status: 201 });
}
