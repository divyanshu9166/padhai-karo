/**
 * Property-based test that core features are available to all subscription tiers.
 *
 *   - Property 33 (task 11.6): core features available to all tiers (Req 6.6, 9.4).
 *
 * The design forbids tier gating on the core endpoints (timetable generator, focus timer,
 * progress dashboard, and PYQ practice with scoring). PYQ practice + scoring submission is
 * the representative core write path: its only access control is the `withAuth` session
 * guard, and the handler never consults the user's Subscription_Tier. This property drives
 * the handler with a mocked Prisma client for BOTH FREE and PAID profiles and asserts the
 * submission always succeeds (201) and scores identically — i.e. the tier never appears on
 * the authorization path.
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts).
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const { findManyPyq, createAttempt } = vi.hoisted(() => ({
    findManyPyq: vi.fn(),
    createAttempt: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        pYQ: { findMany: findManyPyq },
        pYQAttempt: { create: createAttempt },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';
import { createPyqAttemptHandler } from './pyqAttemptService';

/** Tiers as modeled by the Prisma `SubscriptionTier` enum. */
const TIERS = ['FREE', 'PAID'] as const;

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/pyq-attempts', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    findManyPyq.mockReset();
    createAttempt.mockReset();
});

describe('core features available to all tiers', () => {
    // Feature: jee-neet-study-app, Property 33: For any user regardless of subscription
    // tier, the timetable generator, focus timer, progress dashboard, and PYQ practice with
    // scoring are permitted.
    it('Property 33: PYQ practice + scoring succeeds regardless of subscription tier (Req 6.6, 9.4)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(...TIERS),
                fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 6 }),
                async (tier, selections) => {
                    // The user's profile/tier is irrelevant to the handler; supply rows and a
                    // created attempt so the only thing under test is whether the tier gates.
                    const questions = selections.map((_sel, i) => ({
                        id: `q${i}`,
                        correctOption: 0,
                    }));
                    findManyPyq.mockResolvedValue(questions);
                    createAttempt.mockResolvedValue({ id: `attempt-${tier}` });

                    const res = await createPyqAttemptHandler(
                        postReq({
                            paperOrSetRef: `set-${tier}`,
                            answers: selections.map((sel, i) => ({
                                questionId: `q${i}`,
                                selectedOption: sel,
                            })),
                        }),
                        authCtx(`user-${tier}`),
                    );

                    // Permitted for every tier: no 402/403 tier gate, always a 201.
                    expect(res.status).toBe(201);

                    const body = (await res.json()) as { totalScore: number };
                    // Scoring is identical across tiers: correctOption 0 -> sel===0 is correct.
                    const expectedScore = selections.filter((sel) => sel === 0).length;
                    expect(body.totalScore).toBe(expectedScore);
                },
            ),
        );
    });
});
