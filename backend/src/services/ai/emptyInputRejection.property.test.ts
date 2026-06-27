import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Property test for the AI Notes Service — empty-input rejection (task 16.4).
 *
 *   - Property 39 (Req 8.3): for ANY note text consisting solely of whitespace, the AI
 *     summarize request is rejected with a validation error.
 *
 * Exercised at two levels in a single fast-check property:
 *   1. the pure {@link validateSummaryInput} rejects with EMPTY_INPUT; and
 *   2. the handler's 422 path for a PAID profile with remaining quota > 0 — confirming the
 *      whitespace text reaches validation (past the tier + quota gates) and is rejected.
 *
 * Prisma is mocked and the AI provider is injected as a mock, so the property is
 * DB/network-independent and deterministic.
 *
 * Validates: Requirements 8.3
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
import { validateSummaryInput } from './inputValidation';
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

/** A summarizer that must NEVER be called on the empty-input path. */
function neverSummarizer(): AiSummarizer {
    return {
        summarize: vi.fn(async () => {
            throw new Error('summarizer must not be called for empty input');
        }),
    };
}

/** Whitespace-only string generator: any combo of space/tab/newline chars, incl. empty. */
const whitespaceOnly = fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v', '\u00a0'), { maxLength: 12 })
    .map((chars) => chars.join(''));

beforeEach(() => {
    findUniqueProfile.mockReset();
    updateProfile.mockReset();
    createSummary.mockReset();
    createUsage.mockReset();
});

describe('AI notes empty-input rejection property', () => {
    // Feature: jee-neet-study-app, Property 39: For any note text consisting solely of
    // whitespace, the AI notes request is rejected with a validation error.
    it('Property 39: empty-input rejection (Req 8.3)', async () => {
        await fc.assert(
            fc.asyncProperty(
                whitespaceOnly,
                // A paid profile with remaining quota so the request reaches validation.
                fc.integer({ min: 1, max: 1000 }),
                async (text, aiQuota) => {
                    // (1) Pure validation rejects whitespace-only text with EMPTY_INPUT.
                    const validation = validateSummaryInput({ inputType: 'TEXT', text });
                    expect(validation.ok).toBe(false);
                    if (!validation.ok) {
                        expect(validation.code).toBe('EMPTY_INPUT');
                    }

                    // (2) Handler 422 path with a PAID profile + quota > 0.
                    findUniqueProfile.mockReset();
                    updateProfile.mockReset();
                    createSummary.mockReset();
                    createUsage.mockReset();
                    findUniqueProfile.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota });
                    createUsage.mockResolvedValue({ id: 'usage-1' });

                    const res = await createSummaryHandler(
                        post({ inputType: 'TEXT', text }),
                        authCtx(),
                        neverSummarizer(),
                    );

                    expect(res.status).toBe(422);
                    const body = (await res.json()) as { error: { code: string } };
                    expect(body.error.code).toBe('EMPTY_INPUT');

                    // No summary persisted and quota NOT decremented on validation rejection.
                    expect(createSummary).not.toHaveBeenCalled();
                    expect(updateProfile).not.toHaveBeenCalled();
                },
            ),
        );
    });
});
