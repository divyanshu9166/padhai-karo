import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the AI Notes Service (task 16.1).
 *
 * The handler is exercised against a mocked Prisma client and a mocked AiSummarizer so we
 * never touch a live database or call a real provider. The tests assert the EXACT
 * order-of-operations and usage-accounting semantics from the design:
 *   - free tier            -> 402, NO usage recorded                       (Req 9.1)
 *   - paid, quota 0        -> 429, NO usage recorded                       (Req 9.2)
 *   - paid, empty input    -> 422, EXACTLY ONE usage, NO quota decrement   (Req 8.3/8.5/9.3)
 *   - paid, valid input    -> 201, summary persisted + ONE usage + quota-1 (Req 8.4/8.6/9.3)
 *   - provider failure      -> 503, NO usage, NO quota decrement           (design)
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.3
 */

// --- Prisma mock -------------------------------------------------------------
const { findUniqueProfile, updateProfile, createSummary, findManySummary, createUsage } =
    vi.hoisted(() => ({
        findUniqueProfile: vi.fn(),
        updateProfile: vi.fn(),
        createSummary: vi.fn(),
        findManySummary: vi.fn(),
        createUsage: vi.fn(),
    }));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: findUniqueProfile, update: updateProfile },
        noteSummary: { create: createSummary, findMany: findManySummary },
        aiUsageEvent: { create: createUsage },
        // Interactive transaction: invoke the callback with the same mock client so the
        // create/update calls inside are observed by our spies.
        $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
    };
    return { default: prisma, prisma };
});

import { createSummaryHandler, listSummariesHandler } from './aiNotesService';
import type { AiSummarizer } from './types';
import type { AuthContext } from '@/lib/auth';

const BASE = 'http://localhost/api/ai/summaries';

function post(body?: unknown): Request {
    return new Request(BASE, {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

/** A mock summarizer that returns a fixed structured result and never calls a real API. */
function okSummarizer(): AiSummarizer {
    return { summarize: vi.fn(async () => ({ keyPoints: ['point one', 'point two'] })) };
}

/** A mock summarizer that simulates a provider/transport failure. */
function failingSummarizer(): AiSummarizer {
    return {
        summarize: vi.fn(async () => {
            throw new Error('provider timeout');
        }),
    };
}

beforeEach(() => {
    findUniqueProfile.mockReset();
    updateProfile.mockReset();
    createSummary.mockReset();
    findManySummary.mockReset();
    createUsage.mockReset();
});

describe('createSummaryHandler — tier gate (Req 9.1)', () => {
    it('rejects a free-tier user with 402 and records NO usage', async () => {
        findUniqueProfile.mockResolvedValue({ subscriptionTier: 'FREE', aiQuota: 0 });

        const res = await createSummaryHandler(post({ inputType: 'TEXT', text: 'hi' }), authCtx());

        expect(res.status).toBe(402);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('UPGRADE_REQUIRED');
        // No usage, no summary, no decrement.
        expect(createUsage).not.toHaveBeenCalled();
        expect(createSummary).not.toHaveBeenCalled();
        expect(updateProfile).not.toHaveBeenCalled();
    });
});

describe('createSummaryHandler — quota gate (Req 9.2)', () => {
    it('rejects a paid user with zero quota with 429 and records NO usage', async () => {
        findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: 0 });

        const res = await createSummaryHandler(post({ inputType: 'TEXT', text: 'hi' }), authCtx());

        expect(res.status).toBe(429);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('QUOTA_EXCEEDED');
        expect(createUsage).not.toHaveBeenCalled();
        expect(createSummary).not.toHaveBeenCalled();
        expect(updateProfile).not.toHaveBeenCalled();
    });
});

describe('createSummaryHandler — input validation (Req 8.3, 8.5, 9.3)', () => {
    it('rejects empty/whitespace text with 422, records EXACTLY ONE usage, no decrement', async () => {
        findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: 5 });

        const res = await createSummaryHandler(
            post({ inputType: 'TEXT', text: '   ' }),
            authCtx('user-9'),
        );

        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('EMPTY_INPUT');

        // EXACTLY ONE usage unit, marked VALIDATION_REJECTED with no summary link.
        expect(createUsage).toHaveBeenCalledTimes(1);
        expect(createUsage).toHaveBeenCalledWith({
            data: { userId: 'user-9', outcome: 'VALIDATION_REJECTED', summaryId: null },
        });
        // Quota is NOT decremented and no summary persisted.
        expect(updateProfile).not.toHaveBeenCalled();
        expect(createSummary).not.toHaveBeenCalled();
    });
});

describe('createSummaryHandler — production (Req 8.1, 8.4, 8.6, 9.3)', () => {
    it('persists the summary, records ONE usage, decrements quota by one, returns 201', async () => {
        findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: 5 });
        createSummary.mockResolvedValue({
            id: 'sum-1',
            userId: 'user-7',
            inputType: 'TEXT',
            summary: { keyPoints: ['point one', 'point two'] },
        });
        updateProfile.mockResolvedValue({ aiQuota: 4 });

        const summarizer = okSummarizer();
        const res = await createSummaryHandler(
            post({ inputType: 'TEXT', text: 'Newton laws of motion' }),
            authCtx('user-7'),
            summarizer,
        );

        expect(res.status).toBe(201);
        const body = (await res.json()) as { summary: { id: string }; remainingQuota: number };
        expect(body.summary.id).toBe('sum-1');
        expect(body.remainingQuota).toBe(4);

        // The provider was called exactly once with the validated input.
        expect(summarizer.summarize).toHaveBeenCalledTimes(1);
        expect(summarizer.summarize).toHaveBeenCalledWith({
            inputType: 'TEXT',
            text: 'Newton laws of motion',
        });

        // Summary persisted with the structured result.
        expect(createSummary).toHaveBeenCalledTimes(1);
        expect(createSummary).toHaveBeenCalledWith({
            data: {
                userId: 'user-7',
                inputType: 'TEXT',
                summary: { keyPoints: ['point one', 'point two'] },
            },
        });

        // EXACTLY ONE usage unit, marked PRODUCED and linked to the summary.
        expect(createUsage).toHaveBeenCalledTimes(1);
        expect(createUsage).toHaveBeenCalledWith({
            data: { userId: 'user-7', outcome: 'PRODUCED', summaryId: 'sum-1' },
        });

        // Quota decremented by EXACTLY one.
        expect(updateProfile).toHaveBeenCalledTimes(1);
        expect(updateProfile).toHaveBeenCalledWith({
            where: { userId: 'user-7' },
            data: { aiQuota: { decrement: 1 } },
            select: { aiQuota: true },
        });
    });

    it('supports PHOTO input via the vision-capable provider (Req 8.2)', async () => {
        findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: 2 });
        createSummary.mockResolvedValue({ id: 'sum-2', inputType: 'PHOTO', summary: {} });
        updateProfile.mockResolvedValue({ aiQuota: 1 });

        const summarizer = okSummarizer();
        const res = await createSummaryHandler(
            post({ inputType: 'PHOTO', imageUploadId: 'img-42' }),
            authCtx('user-7'),
            summarizer,
        );

        expect(res.status).toBe(201);
        expect(summarizer.summarize).toHaveBeenCalledWith({
            inputType: 'PHOTO',
            imageUploadId: 'img-42',
        });
        expect(createSummary).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ inputType: 'PHOTO' }) }),
        );
    });
});

describe('createSummaryHandler — provider failure (design "AI Provider Failures")', () => {
    it('returns 503 and records NO usage / NO quota decrement on provider failure', async () => {
        findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: 5 });

        const res = await createSummaryHandler(
            post({ inputType: 'TEXT', text: 'valid text' }),
            authCtx(),
            failingSummarizer(),
        );

        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('AI_PROVIDER_UNAVAILABLE');
        // The user is not charged for an infrastructure failure.
        expect(createUsage).not.toHaveBeenCalled();
        expect(createSummary).not.toHaveBeenCalled();
        expect(updateProfile).not.toHaveBeenCalled();
    });
});

describe('createSummaryHandler — missing profile', () => {
    it('returns 404 when the user has no profile and records no usage', async () => {
        findUniqueProfile.mockResolvedValue(null);

        const res = await createSummaryHandler(post({ inputType: 'TEXT', text: 'hi' }), authCtx());

        expect(res.status).toBe(404);
        expect(createUsage).not.toHaveBeenCalled();
    });
});

describe('listSummariesHandler', () => {
    it("returns the authenticated user's summaries, newest first", async () => {
        findManySummary.mockResolvedValue([{ id: 'sum-1' }, { id: 'sum-2' }]);

        const res = await listSummariesHandler(new Request(BASE), authCtx('user-7'));

        expect(res.status).toBe(200);
        const body = (await res.json()) as { summaries: Array<{ id: string }> };
        expect(body.summaries).toHaveLength(2);
        expect(findManySummary).toHaveBeenCalledWith({
            where: { userId: 'user-7' },
            orderBy: { createdAt: 'desc' },
        });
    });
});
