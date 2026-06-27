import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Auth & per-user isolation integration tests for the Performance Analytics endpoints
 * (task 28.2; design "Testing Strategy → Integration", "Error Handling → Auth &
 * Authorization Errors"; Req 14.1, 14.3).
 *
 * Two guarantees are exercised end-to-end through the REAL exported route handlers (each
 * wrapped by `withAuth`) and their real service handlers:
 *
 *   1. Tokenless -> 401 (Req 14.1): every `/api/analytics/*` verb rejects a request that
 *      carries no `Authorization: Bearer` token with `401 UNAUTHORIZED`, before any handler
 *      logic or database access. This reuses the same approach as
 *      `auth/protected-route-guard.test.ts`: drive the real wrapped handler with a request
 *      that has no Authorization header. The `extractBearerToken` parse stays REAL (so a
 *      missing header is genuinely tokenless), while `resolveSession` is the only seam
 *      overridden — it is never reached on the tokenless path.
 *
 *   2. Cross-user -> 403 (Req 14.3): a request that references another user's resource is
 *      rejected with `403 FORBIDDEN`. We mock a VALID session for the requesting user
 *      (`resolveSession` resolves to `requester`) and back the mocked Prisma row with a
 *      different owner, so `assertOwnership` throws `ForbiddenError`, which `withAuth` maps
 *      to `403 FORBIDDEN`. Covered: editing/deleting a mock score owned by another user, and
 *      reading attempt quality for an attempt owned by another user.
 *
 * Prisma is mocked (`vi.hoisted` + `vi.mock('@/lib/db')`) so the suite is DB-independent; on
 * the tokenless path the database is never touched, and on the cross-user path only the
 * single owning-row lookup is needed (ownership is asserted before any write).
 */

// --- Hoisted seams -----------------------------------------------------------
const mocks = vi.hoisted(() => ({
    resolveSession: vi.fn(),
    externalMockScoreFindUnique: vi.fn(),
    externalMockScoreUpdate: vi.fn(),
    externalMockScoreDelete: vi.fn(),
    pYQAttemptFindUnique: vi.fn(),
    timedPaperAttemptFindUnique: vi.fn(),
}));

// Mock the Prisma client. Only the lookups used by the cross-user ownership checks are
// needed; the tokenless 401 path never reaches the database.
vi.mock('@/lib/db', () => {
    const prisma = {
        externalMockScore: {
            findUnique: mocks.externalMockScoreFindUnique,
            update: mocks.externalMockScoreUpdate,
            delete: mocks.externalMockScoreDelete,
        },
        pYQAttempt: { findUnique: mocks.pYQAttemptFindUnique },
        timedPaperAttempt: { findUnique: mocks.timedPaperAttemptFindUnique },
    };
    return { prisma, default: prisma };
});

// Keep `extractBearerToken` REAL (so a missing header is genuinely tokenless) and override
// only `resolveSession`. `withAuth` (in `@/lib/auth/guard`) imports both from this module.
vi.mock('@/lib/auth/session', async (importActual) => {
    const actual = await importActual<typeof import('@/lib/auth/session')>();
    return { ...actual, resolveSession: mocks.resolveSession };
});

// --- Exported route handlers under test --------------------------------------
import { GET as attemptQualityTrendGet } from './attempt-quality-trend/route';
import { GET as attemptQualityGet } from './attempts/[attemptId]/quality/route';
import { GET as cutoffsGet } from './cutoffs/route';
import { GET as mockScoreListGet, POST as mockScorePost } from './mock-scores/route';
import {
    DELETE as mockScoreDelete,
    PATCH as mockScorePatch,
} from './mock-scores/[id]/route';
import { GET as rankPredictionGet } from './rank-prediction/route';
import { GET as scoreGapGet } from './score-gap/route';
import { GET as scoreTrajectoryGet } from './score-trajectory/route';
import {
    GET as targetCutoffGet,
    PUT as targetCutoffPut,
} from './target-cutoff/route';
import { GET as topicPriorityGet } from './topic-priority/route';
import { GET as topicTrendsGet } from './topic-trends/route';
import { GET as weakAreasGet } from './weak-areas/route';

import type { ResolvedSession } from '@/lib/auth/session';

type RouteHandler = (request: Request, routeContext: unknown) => Promise<Response>;

/** Every analytics route verb, exercised for the tokenless -> 401 guarantee (Req 14.1). */
const analyticsEndpoints: Array<[string, RouteHandler]> = [
    ['POST /analytics/mock-scores', mockScorePost as RouteHandler],
    ['GET /analytics/mock-scores', mockScoreListGet as RouteHandler],
    ['PATCH /analytics/mock-scores/:id', mockScorePatch as RouteHandler],
    ['DELETE /analytics/mock-scores/:id', mockScoreDelete as RouteHandler],
    ['GET /analytics/score-trajectory', scoreTrajectoryGet as RouteHandler],
    ['GET /analytics/rank-prediction', rankPredictionGet as RouteHandler],
    ['GET /analytics/cutoffs', cutoffsGet as RouteHandler],
    ['GET /analytics/target-cutoff', targetCutoffGet as RouteHandler],
    ['PUT /analytics/target-cutoff', targetCutoffPut as RouteHandler],
    ['GET /analytics/score-gap', scoreGapGet as RouteHandler],
    ['GET /analytics/topic-trends', topicTrendsGet as RouteHandler],
    ['GET /analytics/topic-priority', topicPriorityGet as RouteHandler],
    ['GET /analytics/attempts/:attemptId/quality', attemptQualityGet as RouteHandler],
    ['GET /analytics/attempt-quality-trend', attemptQualityTrendGet as RouteHandler],
    ['GET /analytics/weak-areas', weakAreasGet as RouteHandler],
];

/** A dynamic-segment route context (forwarded as the wrapped handler's third argument). */
function routeContext(params: Record<string, string>): unknown {
    return { params };
}

/** Build a resolved session for `userId` so `withAuth` admits the request. */
function sessionFor(userId: string): ResolvedSession {
    return {
        user: { id: userId } as ResolvedSession['user'],
        session: {} as ResolvedSession['session'],
    };
}

describe('Performance Analytics auth & per-user isolation (Req 14.1, 14.3)', () => {
    describe('tokenless requests are rejected with 401 UNAUTHORIZED (Req 14.1)', () => {
        it.each(analyticsEndpoints)(
            '%s without an Authorization header returns 401 UNAUTHORIZED',
            async (_name, handler) => {
                const response = await handler(
                    new Request('https://api.test/analytics'),
                    routeContext({ id: 'x', attemptId: 'x' }),
                );

                expect(response.status).toBe(401);
                const body = await response.json();
                expect(body.error.code).toBe('UNAUTHORIZED');
            },
        );

        it.each(analyticsEndpoints)(
            '%s with a non-Bearer Authorization header returns 401 UNAUTHORIZED',
            async (_name, handler) => {
                const response = await handler(
                    new Request('https://api.test/analytics', {
                        headers: { authorization: 'Basic dXNlcjpwYXNz' },
                    }),
                    routeContext({ id: 'x', attemptId: 'x' }),
                );

                expect(response.status).toBe(401);
                const body = await response.json();
                expect(body.error.code).toBe('UNAUTHORIZED');
            },
        );
    });

    describe('cross-user references are rejected with 403 FORBIDDEN (Req 14.3)', () => {
        const REQUESTER = 'user-requester';
        const OWNER = 'user-other-owner';

        beforeEachResolveAs(REQUESTER);

        it('PATCH /analytics/mock-scores/:id on a mock score owned by another user returns 403', async () => {
            mocks.externalMockScoreFindUnique.mockResolvedValueOnce({
                id: 'ms-1',
                userId: OWNER,
                source: 'OTHER',
                sourceName: 'Other',
                testDate: new Date('2025-01-01T00:00:00.000Z'),
                obtainedScore: 100,
                maxScore: 200,
            });

            const response = await (mockScorePatch as RouteHandler)(
                new Request('https://api.test/analytics/mock-scores/ms-1', {
                    method: 'PATCH',
                    headers: { authorization: 'Bearer valid-token' },
                    body: JSON.stringify({ obtainedScore: 150 }),
                }),
                routeContext({ id: 'ms-1' }),
            );

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error.code).toBe('FORBIDDEN');
            // Ownership is asserted before any write.
            expect(mocks.externalMockScoreUpdate).not.toHaveBeenCalled();
        });

        it('DELETE /analytics/mock-scores/:id on a mock score owned by another user returns 403', async () => {
            mocks.externalMockScoreFindUnique.mockResolvedValueOnce({
                id: 'ms-1',
                userId: OWNER,
            });

            const response = await (mockScoreDelete as RouteHandler)(
                new Request('https://api.test/analytics/mock-scores/ms-1', {
                    method: 'DELETE',
                    headers: { authorization: 'Bearer valid-token' },
                }),
                routeContext({ id: 'ms-1' }),
            );

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error.code).toBe('FORBIDDEN');
            expect(mocks.externalMockScoreDelete).not.toHaveBeenCalled();
        });

        it('GET /analytics/attempts/:attemptId/quality on a PYQ attempt owned by another user returns 403', async () => {
            mocks.pYQAttemptFindUnique.mockResolvedValueOnce({
                userId: OWNER,
                perQuestion: [],
            });

            const response = await (attemptQualityGet as RouteHandler)(
                new Request('https://api.test/analytics/attempts/att-1/quality?type=PYQ', {
                    headers: { authorization: 'Bearer valid-token' },
                }),
                routeContext({ attemptId: 'att-1' }),
            );

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error.code).toBe('FORBIDDEN');
        });

        it('GET /analytics/attempts/:attemptId/quality on a TIMED attempt owned by another user returns 403', async () => {
            mocks.timedPaperAttemptFindUnique.mockResolvedValueOnce({
                userId: OWNER,
                perQuestion: [],
                timeTakenSec: 600,
            });

            const response = await (attemptQualityGet as RouteHandler)(
                new Request('https://api.test/analytics/attempts/att-2/quality?type=TIMED', {
                    headers: { authorization: 'Bearer valid-token' },
                }),
                routeContext({ attemptId: 'att-2' }),
            );

            expect(response.status).toBe(403);
            const body = await response.json();
            expect(body.error.code).toBe('FORBIDDEN');
        });
    });
});

/**
 * Register a `beforeEach` that makes `resolveSession` admit a valid session for `userId`
 * (and resets the per-test Prisma lookup mocks). Declared as a helper so the cross-user
 * block reads top-down.
 */
function beforeEachResolveAs(userId: string): void {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveSession.mockResolvedValue(sessionFor(userId));
    });
}
