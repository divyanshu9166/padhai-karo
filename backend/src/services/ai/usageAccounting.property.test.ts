import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Property test for the AI Notes Service — exactly one usage unit per attempt (task 16.5).
 *
 *   - Property 40 (Req 8.4, 8.5): for ANY paid-tier request that passes the tier and quota
 *     gates, EXACTLY ONE AiUsageEvent is recorded whether the request produces a summary OR
 *     is rejected for empty input.
 *
 * The generator picks, per iteration, either a valid TEXT/PHOTO input (which produces a
 * summary) or a whitespace-only TEXT input (which is rejected for empty input). In both
 * branches the request is past the tier + quota gates (PAID, quota > 0), and exactly one
 * usage event must be recorded.
 *
 * Prisma is mocked and the AI provider injected as a mock, so the property is
 * DB/network-independent and deterministic.
 *
 * Validates: Requirements 8.4, 8.5
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

function okSummarizer(): AiSummarizer {
    return { summarize: vi.fn(async () => ({ keyPoints: ['kp'] })) };
}

/** Whitespace-only string generator (rejected for empty input). */
const whitespaceOnly = fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 8 })
    .map((chars) => chars.join(''));

/** A valid (producing) request: non-blank TEXT or a PHOTO with an image reference. */
const validInput = fc.oneof(
    fc
        .string({ minLength: 1 })
        .map((s) => `note ${s}`)
        .map((text) => ({ inputType: 'TEXT' as const, text })),
    fc
        .string({ minLength: 1 })
        .map((s) => ({ inputType: 'PHOTO' as const, imageUploadId: `img-${s}` })),
);

/** An empty (rejected) request: whitespace-only TEXT. */
const emptyInput = whitespaceOnly.map((text) => ({ inputType: 'TEXT' as const, text }));

beforeEach(() => {
    findUniqueProfile.mockReset();
    updateProfile.mockReset();
    createSummary.mockReset();
    createUsage.mockReset();
});

describe('AI notes usage-accounting property', () => {
    // Feature: jee-neet-study-app, Property 40: For any paid-tier AI request that passes the
    // tier and quota gates, exactly one unit of AI usage is recorded whether the request
    // produces a summary or is rejected for input validation.
    it('Property 40: exactly one usage unit per AI attempt (Req 8.4, 8.5)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.oneof(
                    validInput.map((body) => ({ body, produces: true })),
                    emptyInput.map((body) => ({ body, produces: false })),
                ),
                fc.integer({ min: 1, max: 1000 }),
                async ({ body, produces }, aiQuota) => {
                    findUniqueProfile.mockReset();
                    updateProfile.mockReset();
                    createSummary.mockReset();
                    createUsage.mockReset();

                    findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota });
                    createSummary.mockResolvedValue({ id: 'sum-1' });
                    createUsage.mockResolvedValue({ id: 'usage-1' });
                    updateProfile.mockResolvedValue({ aiQuota: aiQuota - 1 });

                    const res = await createSummaryHandler(post(body), authCtx(), okSummarizer());

                    if (produces) {
                        expect(res.status).toBe(201);
                    } else {
                        expect(res.status).toBe(422);
                    }

                    // The invariant: EXACTLY ONE usage event recorded on either branch.
                    expect(createUsage).toHaveBeenCalledTimes(1);
                },
            ),
        );
    });
});
