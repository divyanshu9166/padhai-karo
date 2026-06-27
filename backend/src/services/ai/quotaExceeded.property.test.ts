import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Property test for the AI Notes Service — quota-exceeded rejection (task 16.7).
 *
 *   - Property 42 (Req 9.2): for ANY paid-tier user whose remaining quota is zero, an AI
 *     summarization request is rejected with a 429 QUOTA_EXCEEDED response and records ZERO
 *     AI usage events — regardless of the input. A zero-quota paid user passes the tier gate
 *     but is stopped at the quota gate, before input validation.
 *
 * Prisma is mocked and the AI provider injected as a mock, so the property is
 * DB/network-independent and deterministic.
 *
 * Validates: Requirements 9.2
 */

// --- Prisma mock -------------------------------------------------------------
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

/** A summarizer that must NEVER be called for a zero-quota request. */
function neverSummarizer(): AiSummarizer {
    return {
        summarize: vi.fn(async () => {
            throw new Error('summarizer must not be called when quota is exhausted');
        }),
    };
}

/** Any request body — the quota gate runs before input validation. */
const anyInput = fc.oneof(
    fc.string({ minLength: 1 }).map((s) => ({ inputType: 'TEXT' as const, text: `note ${s}` })),
    fc.constantFrom(' ', '', '\t\n').map((text) => ({ inputType: 'TEXT' as const, text })),
    fc.string({ minLength: 1 }).map((s) => ({ inputType: 'PHOTO' as const, imageUploadId: `img-${s}` })),
);

beforeEach(() => {
    findUniqueProfile.mockReset();
    updateProfile.mockReset();
    createSummary.mockReset();
    createUsage.mockReset();
});

describe('AI notes quota-exceeded rejection property', () => {
    // Feature: jee-neet-study-app, Property 42: For any paid-tier user whose remaining quota
    // is zero, an AI summarization request is rejected with a quota-exceeded response and
    // records no usage.
    it('Property 42: quota-exceeded rejection (Req 9.2)', async () => {
        await fc.assert(
            fc.asyncProperty(
                anyInput,
                // Non-positive remaining quota (0 and below) all hit the quota gate.
                fc.integer({ min: -50, max: 0 }),
                async (body, aiQuota) => {
                    findUniqueProfile.mockReset();
                    updateProfile.mockReset();
                    createSummary.mockReset();
                    createUsage.mockReset();

                    findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota });

                    const res = await createSummaryHandler(post(body), authCtx(), neverSummarizer());

                    expect(res.status).toBe(429);
                    const responseBody = (await res.json()) as { error: { code: string } };
                    expect(responseBody.error.code).toBe('QUOTA_EXCEEDED');

                    // Zero usage recorded, nothing persisted, no quota change.
                    expect(createUsage).not.toHaveBeenCalled();
                    expect(createSummary).not.toHaveBeenCalled();
                    expect(updateProfile).not.toHaveBeenCalled();
                },
            ),
        );
    });
});
