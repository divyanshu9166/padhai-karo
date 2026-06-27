import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Property test for the AI Notes Service — free-tier rejection records no usage (task 16.6).
 *
 *   - Property 41 (Req 9.1): for ANY free-tier user, an AI summarization request is rejected
 *     with a 402 UPGRADE_REQUIRED response and records ZERO AI usage events — regardless of
 *     the input (valid or empty) or the (irrelevant) quota value. Free users never reach the
 *     quota gate or input validation.
 *
 * Prisma is mocked and the AI provider injected as a mock, so the property is
 * DB/network-independent and deterministic.
 *
 * Validates: Requirements 9.1
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

/** A summarizer that must NEVER be called for a free-tier request. */
function neverSummarizer(): AiSummarizer {
    return {
        summarize: vi.fn(async () => {
            throw new Error('summarizer must not be called for a free-tier user');
        }),
    };
}

/** Any request body — valid TEXT/PHOTO or empty — since the tier gate runs first. */
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

describe('AI notes free-tier rejection property', () => {
    // Feature: jee-neet-study-app, Property 41: For any free-tier user, an AI summarization
    // request is rejected with an upgrade-required response and records no AI usage.
    it('Property 41: free-tier rejection records no usage (Req 9.1)', async () => {
        await fc.assert(
            fc.asyncProperty(
                anyInput,
                // quota is irrelevant for a free user; vary it to prove it is never consulted.
                fc.integer({ min: 0, max: 1000 }),
                async (body, aiQuota) => {
                    findUniqueProfile.mockReset();
                    updateProfile.mockReset();
                    createSummary.mockReset();
                    createUsage.mockReset();

                    findUniqueProfile.mockResolvedValue({ subscriptionTier: 'FREE', aiQuota });

                    const res = await createSummaryHandler(post(body), authCtx(), neverSummarizer());

                    expect(res.status).toBe(402);
                    const responseBody = (await res.json()) as { error: { code: string } };
                    expect(responseBody.error.code).toBe('UPGRADE_REQUIRED');

                    // Zero usage recorded, nothing persisted, no quota change.
                    expect(createUsage).not.toHaveBeenCalled();
                    expect(createSummary).not.toHaveBeenCalled();
                    expect(updateProfile).not.toHaveBeenCalled();
                },
            ),
        );
    });
});
