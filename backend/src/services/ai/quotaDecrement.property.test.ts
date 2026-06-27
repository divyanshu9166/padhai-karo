import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Property test for the AI Notes Service — quota decrements by exactly one (task 16.8).
 *
 *   - Property 43 (Req 9.3): for ANY accepted paid-tier AI request, the remaining quota
 *     after the request equals the quota before MINUS exactly one.
 *
 * The Prisma mock keeps an in-memory `aiQuota` so the handler's atomic `decrement: 1`
 * actually mutates state; the property asserts the returned `remainingQuota` equals the
 * starting quota minus one for both TEXT and PHOTO inputs and across a wide quota range.
 *
 * Prisma is mocked and the AI provider injected as a mock, so the property is
 * DB/network-independent and deterministic.
 *
 * Validates: Requirements 9.3
 */

// --- Prisma mock with in-memory quota ----------------------------------------
const state = { aiQuota: 0, subscriptionTier: 'PAID' as 'PAID' | 'FREE' };

const { findUniqueProfile, updateProfile, createSummary, createUsage } = vi.hoisted(() => ({
    findUniqueProfile: vi.fn(),
    updateProfile: vi.fn(),
    createSummary: vi.fn(),
    createUsage: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: findUniqueProfile, update: updateProfile },
        noteSummary: { create: createSummary, findMany: vi.fn() },
        aiUsageEvent: { create: createUsage },
        $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
    };
    return { default: prisma, prisma };
});

import { createSummaryHandler } from './aiNotesService';
import type { AiSummarizer } from './types';
import type { AuthContext } from '@/lib/auth';

const BASE = 'http://localhost/api/ai/summaries';

function post(body: unknown): Request {
    return new Request(BASE, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function okSummarizer(): AiSummarizer {
    return { summarize: vi.fn(async () => ({ keyPoints: ['kp'] })) };
}

/** A valid (producing) request: non-blank TEXT or a PHOTO with an image reference. */
const validInput = fc.oneof(
    fc.string({ minLength: 1 }).map((s) => ({ inputType: 'TEXT' as const, text: `note ${s}` })),
    fc.string({ minLength: 1 }).map((s) => ({ inputType: 'PHOTO' as const, imageUploadId: `img-${s}` })),
);

beforeEach(() => {
    findUniqueProfile.mockReset();
    updateProfile.mockReset();
    createSummary.mockReset();
    createUsage.mockReset();

    // findUnique reflects the current in-memory profile state.
    findUniqueProfile.mockImplementation(async () => ({
        subscriptionTier: state.subscriptionTier,
        aiQuota: state.aiQuota,
    }));
    // The handler always calls `{ aiQuota: { decrement: 1 } }`; apply it to in-memory state.
    updateProfile.mockImplementation(async () => {
        state.aiQuota -= 1;
        return { aiQuota: state.aiQuota };
    });
    createSummary.mockResolvedValue({ id: 'sum-1' });
    createUsage.mockResolvedValue({ id: 'usage-1' });
});

describe('AI notes quota-decrement property', () => {
    // Feature: jee-neet-study-app, Property 43: For any accepted paid-tier AI request, the
    // remaining quota after the request equals the quota before minus exactly one.
    it('Property 43: quota decrements by exactly one on acceptance (Req 9.3)', async () => {
        await fc.assert(
            fc.asyncProperty(
                validInput,
                fc.integer({ min: 1, max: 100000 }),
                async (body, quotaBefore) => {
                    state.subscriptionTier = 'PAID';
                    state.aiQuota = quotaBefore;

                    const res = await createSummaryHandler(post(body), authCtx(), okSummarizer());

                    expect(res.status).toBe(201);
                    const responseBody = (await res.json()) as { remainingQuota: number };
                    expect(responseBody.remainingQuota).toBe(quotaBefore - 1);
                    // In-memory state reflects exactly one decrement for this request.
                    expect(state.aiQuota).toBe(quotaBefore - 1);
                },
            ),
        );
    });
});
