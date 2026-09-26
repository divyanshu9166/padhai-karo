import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    profileFind: vi.fn(),
    profileUpdateMany: vi.fn(),
    usageCount: vi.fn(),
    usageFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: mocks.profileFind, updateMany: mocks.profileUpdateMany },
        aiUsageEvent: { count: mocks.usageCount, findMany: mocks.usageFindMany },
    };
    return { prisma, default: prisma };
});

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';

import { FREE_WEEKLY_AI_LIMIT, TRIAL_AI_LIMIT, resolveAiAllowance, startTrialHandler } from './entitlements';

const auth = { user: { id: 'u1' } } as AuthContext;
const NOW = new Date('2026-09-25T10:00:00.000Z');
const free = { subscriptionTier: 'FREE' as const, aiQuota: 0, trialStartedAt: null, trialEndsAt: null };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.usageCount.mockResolvedValue(0);
    mocks.usageFindMany.mockResolvedValue([]);
    mocks.profileUpdateMany.mockResolvedValue({ count: 1 });
});

describe('resolveAiAllowance', () => {
    it('gives free students the full weekly allowance with nothing used', async () => {
        const allowance = await resolveAiAllowance(prisma as never, 'u1', free, NOW);
        expect(allowance).toEqual({ plan: 'FREE', remaining: FREE_WEEKLY_AI_LIMIT, limit: FREE_WEEKLY_AI_LIMIT, resetsAt: null, trialAvailable: true });
    });

    it('reports when the oldest note in the window frees a slot', async () => {
        const oldest = new Date('2026-09-20T08:00:00.000Z');
        mocks.usageFindMany.mockResolvedValue([{ createdAt: oldest }, { createdAt: new Date('2026-09-24T08:00:00.000Z') }]);
        const allowance = await resolveAiAllowance(prisma as never, 'u1', free, NOW);
        expect(allowance).toMatchObject({ plan: 'FREE', remaining: FREE_WEEKLY_AI_LIMIT - 2 });
        expect(allowance.plan === 'FREE' && allowance.resetsAt?.toISOString()).toBe('2026-09-27T08:00:00.000Z');
        expect(mocks.usageFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: new Date('2026-09-18T10:00:00.000Z') } }) }));
    });

    it('uses the trial allowance while the trial is active and free rules after it ends', async () => {
        const trialStartedAt = new Date('2026-09-22T10:00:00.000Z');
        const active = { ...free, trialStartedAt, trialEndsAt: new Date('2026-09-29T10:00:00.000Z') };
        mocks.usageCount.mockResolvedValue(10);
        expect(await resolveAiAllowance(prisma as never, 'u1', active, NOW)).toMatchObject({ plan: 'TRIAL', remaining: TRIAL_AI_LIMIT - 10 });

        const ended = { ...active, trialEndsAt: new Date('2026-09-24T10:00:00.000Z') };
        expect(await resolveAiAllowance(prisma as never, 'u1', ended, NOW)).toMatchObject({ plan: 'FREE', trialAvailable: false });
    });

    it('uses the purchased quota for paid students', async () => {
        expect(await resolveAiAllowance(prisma as never, 'u1', { ...free, subscriptionTier: 'PAID', aiQuota: 42 }, NOW)).toEqual({ plan: 'PAID', remaining: 42 });
    });
});

describe('startTrialHandler', () => {
    it('starts a 7-day trial once', async () => {
        mocks.profileFind.mockResolvedValue(free);
        const response = await startTrialHandler(new Request('https://api.test/api/subscriptions/trial', { method: 'POST' }), auth);
        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.aiAllowance).toMatchObject({ plan: 'TRIAL', remaining: TRIAL_AI_LIMIT });
        const days = (new Date(body.trialEndsAt).getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(6.99);
        expect(days).toBeLessThanOrEqual(7);
        expect(mocks.profileUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', trialStartedAt: null } }));
    });

    it('refuses a second trial', async () => {
        mocks.profileFind.mockResolvedValue({ ...free, trialStartedAt: new Date('2026-01-01'), trialEndsAt: new Date('2026-01-08') });
        expect((await startTrialHandler(new Request('https://api.test/x', { method: 'POST' }), auth)).status).toBe(409);
    });

    it('refuses when a concurrent request already started the trial', async () => {
        mocks.profileFind.mockResolvedValue(free);
        mocks.profileUpdateMany.mockResolvedValue({ count: 0 });
        expect((await startTrialHandler(new Request('https://api.test/x', { method: 'POST' }), auth)).status).toBe(409);
    });

    it('refuses for paid students', async () => {
        mocks.profileFind.mockResolvedValue({ ...free, subscriptionTier: 'PAID', aiQuota: 5 });
        expect((await startTrialHandler(new Request('https://api.test/x', { method: 'POST' }), auth)).status).toBe(409);
    });
});
