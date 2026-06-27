/**
 * Property-based test for per-user isolation of Allocation_Service outputs (task 13.2;
 * design "Correctness Properties → Property 13").
 *
 *   - Property 13: Outputs are isolated to the requesting User
 *     Validates: Requirements 10.2, 1.4
 *
 * Property 13 (design statement): For any two Users' data, a User's allocation outputs are
 * computed exclusively from that User's own owned data together with the system-supplied
 * `TopicFrequencyReferenceData` and `QuestionTopicMap`; another User's `PYQAttempt`s, Chapters,
 * or preferences never affect the result.
 *
 * We assert this STRUCTURALLY at the data-access seam. The `allocationReader` and the four
 * service handlers route every user-owned read/write through the Prisma client singleton
 * (`@/lib/db`). If — and only if — every user-owned query carries a `where` clause scoped to
 * the *exact* requesting `userId`, no row belonging to another User can ever be selected, so
 * the output cannot depend on another User's data (Req 10.2; PYQ ownership Req 1.4).
 *
 * Strategy (mirrors the analytics `perUserIsolation.property.test.ts` mocked-Prisma convention,
 * `vi.hoisted` + `vi.mock('@/lib/db')`): each Prisma method the reader/handlers touch is a spy
 * that *captures the `where` argument* it was called with. For each generated requesting
 * `userId` we drive all four handlers end-to-end (returning data so the suggested-allocation
 * snapshot upsert and the mode upsert are actually reached), then assert that every call to a
 * USER-OWNED model (`profile.findUnique`, `chapter.findMany`, `pYQAttempt.findMany`,
 * `suggestedAllocationSnapshot.upsert`, `allocationPreference.findUnique` / `.upsert`) was
 * scoped by `where.userId === userId` (and that the snapshot/preference `create` payloads carry
 * the same owner). We also assert no user-owned query is EVER issued without the requesting
 * `userId` scope. The system-supplied reference models (`questionTopicMap`,
 * `topicFrequencyReferenceData`) are global per track and intentionally carry no user scope.
 *
 * The active-version resolver is mocked directly (`vi.mock('@/lib/analytics/referenceVersion')`)
 * so each iteration resolves a concrete reference year and the handlers run their full pipeline.
 *
 * The fast-check assertion runs a minimum of 100 iterations.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock: every method captures the `where` it is called with --------
//
// Each spy records its call arguments (fast-check + vitest retain call history) so after
// driving the handlers we can inspect the `where` clause of every user-owned query. The
// read spies return generated-shaped data so the handlers reach their writes; the write
// spies (upserts) simply resolve.
const {
    profileFindUnique,
    chapterFindMany,
    pyqAttemptFindMany,
    questionTopicMapFindMany,
    topicFrequencyFindMany,
    snapshotUpsert,
    preferenceFindUnique,
    preferenceUpsert,
} = vi.hoisted(() => ({
    profileFindUnique: vi.fn(),
    chapterFindMany: vi.fn(),
    pyqAttemptFindMany: vi.fn(),
    questionTopicMapFindMany: vi.fn(),
    topicFrequencyFindMany: vi.fn(),
    snapshotUpsert: vi.fn(),
    preferenceFindUnique: vi.fn(),
    preferenceUpsert: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        chapter: { findMany: chapterFindMany },
        pYQAttempt: { findMany: pyqAttemptFindMany },
        questionTopicMap: { findMany: questionTopicMapFindMany },
        topicFrequencyReferenceData: { findMany: topicFrequencyFindMany },
        suggestedAllocationSnapshot: { upsert: snapshotUpsert },
        allocationPreference: {
            findUnique: preferenceFindUnique,
            upsert: preferenceUpsert,
        },
    };
    return { default: prisma, prisma };
});

// Resolve a concrete active reference year so the read handlers run the full pipeline.
const { resolveActiveReferenceYearMock } = vi.hoisted(() => ({
    resolveActiveReferenceYearMock: vi.fn(),
}));

vi.mock('@/lib/analytics/referenceVersion', () => ({
    resolveActiveReferenceYear: resolveActiveReferenceYearMock,
}));

import type { AuthContext } from '@/lib/auth';

import { signalHandler } from './signalService';
import { mostFrequentChaptersHandler } from './mostFrequentService';
import { suggestedAllocationHandler } from './suggestedAllocationService';
import { getAllocationModeHandler, updateAllocationModeHandler } from './modeService';

// --- Helpers ----------------------------------------------------------------

function authCtx(userId: string): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function getReq(path: string): Request {
    return new Request(`http://localhost${path}`, { method: 'GET' });
}

function putReq(path: string, body: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/**
 * Arm every spy for one iteration. The reads return generated-shaped data (referencing two
 * distinct attempted questions so `questionTopicMap.findMany` is reached); the preference
 * lookup returns a row OWNED by the requesting user so `assertOwnership` passes; the writes
 * resolve. `userId` is the requesting user (used only to keep the owned preference consistent).
 */
function armSpies(params: {
    userId: string;
    referenceYear: number;
    examTrack: string;
    tier: string;
    language: string;
    mode: string;
}): void {
    profileFindUnique.mockResolvedValue({
        examTrack: params.examTrack,
        language: params.language,
        subscriptionTier: params.tier,
    });

    chapterFindMany.mockResolvedValue([
        {
            id: 'ch-1',
            referenceKey: 'k1',
            status: 'NOT_STARTED',
            weightage: 0.5,
            weightageIsDefault: false,
            weightageOverride: null,
            timeAllocationOverride: null,
        },
        {
            id: 'ch-2',
            referenceKey: 'k2',
            status: 'IN_PROGRESS',
            weightage: 0.5,
            weightageIsDefault: true,
            weightageOverride: null,
            timeAllocationOverride: null,
        },
    ]);

    pyqAttemptFindMany.mockResolvedValue([
        { perQuestion: [{ questionId: 'q1' }, { questionId: 'q2' }] },
    ]);

    questionTopicMapFindMany.mockResolvedValue([
        { questionId: 'q1', topicKey: 'k1' },
        { questionId: 'q2', topicKey: 'k2' },
    ]);

    topicFrequencyFindMany.mockResolvedValue([
        { topicKey: 'k1', avgQuestionsPerYear: 4 },
        { topicKey: 'k2', avgQuestionsPerYear: 2 },
    ]);

    snapshotUpsert.mockResolvedValue({ userId: params.userId });

    // A pre-existing preference owned by the requesting user (so ownership passes and both the
    // GET and PUT exercise the findUnique scope as well as the upsert).
    preferenceFindUnique.mockResolvedValue({ userId: params.userId, mode: params.mode });
    preferenceUpsert.mockResolvedValue({ userId: params.userId, mode: params.mode });

    resolveActiveReferenceYearMock.mockResolvedValue(params.referenceYear);
}

function resetSpies(): void {
    profileFindUnique.mockReset();
    chapterFindMany.mockReset();
    pyqAttemptFindMany.mockReset();
    questionTopicMapFindMany.mockReset();
    topicFrequencyFindMany.mockReset();
    snapshotUpsert.mockReset();
    preferenceFindUnique.mockReset();
    preferenceUpsert.mockReset();
    resolveActiveReferenceYearMock.mockReset();
}

/** Extract the `where` argument from each recorded call of a spy. */
function capturedWheres(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
    return spy.mock.calls.map((args) => {
        const arg = (args[0] ?? {}) as { where?: Record<string, unknown> };
        return arg.where ?? {};
    });
}

beforeEach(() => {
    resetSpies();
});

describe('Allocation_Service per-user isolation (Property 13)', () => {
    // Feature: weightage-based-time-allocation, Property 13: Outputs are isolated to the
    // requesting User
    it('Property 13: every user-owned query is scoped by the exact requesting userId (Req 10.2, 1.4)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.constantFrom('JEE', 'NEET'),
                fc.constantFrom('FREE', 'PAID'),
                fc.constantFrom('EN', 'HI'),
                fc.integer({ min: 2018, max: 2030 }),
                fc.constantFrom('SUGGESTED', 'PHASE1_DEFAULT'),
                async (userId, examTrack, tier, language, referenceYear, mode) => {
                    resetSpies();
                    armSpies({ userId, referenceYear, examTrack, tier, language, mode });

                    const ctx = authCtx(userId);

                    // Drive all handlers that read/write user-owned rows end-to-end. Each
                    // returns 200 because the reads/resolver are armed with data.
                    const responses = await Promise.all([
                        signalHandler(getReq('/api/allocation/signal'), ctx),
                        mostFrequentChaptersHandler(
                            getReq('/api/allocation/most-frequent-chapters'),
                            ctx,
                        ),
                        suggestedAllocationHandler(
                            getReq('/api/allocation/suggested-allocation'),
                            ctx,
                        ),
                        getAllocationModeHandler(getReq('/api/allocation/mode'), ctx),
                        updateAllocationModeHandler(
                            putReq('/api/allocation/mode', { mode }),
                            ctx,
                        ),
                    ]);

                    // Every handler completed successfully (the pipeline actually ran, so the
                    // user-owned queries below were genuinely issued).
                    for (const response of responses) {
                        expect(response.status).toBe(200);
                    }

                    // The single feature write (snapshot upsert) and the preference upsert were
                    // both reached, so their `where`/`create` scoping is genuinely exercised.
                    expect(snapshotUpsert).toHaveBeenCalled();
                    expect(preferenceUpsert).toHaveBeenCalled();

                    // --- The isolation invariant -------------------------------------------
                    // Every call to a USER-OWNED model must be scoped by the exact requesting
                    // userId; no such query may be issued without that scope. This makes it
                    // impossible to select another User's rows (Req 10.2, 1.4).
                    const userOwnedReadSpies: Array<[string, { mock: { calls: unknown[][] } }]> = [
                        ['profile.findUnique', profileFindUnique],
                        ['chapter.findMany', chapterFindMany],
                        ['pYQAttempt.findMany', pyqAttemptFindMany],
                        ['suggestedAllocationSnapshot.upsert', snapshotUpsert],
                        ['allocationPreference.findUnique', preferenceFindUnique],
                        ['allocationPreference.upsert', preferenceUpsert],
                    ];

                    for (const [name, spy] of userOwnedReadSpies) {
                        const wheres = capturedWheres(spy);
                        // The query was actually issued ...
                        expect(wheres.length, `${name} should have been queried`).toBeGreaterThan(0);
                        // ... and every issued query is scoped to exactly the requesting user.
                        for (const where of wheres) {
                            expect(where.userId, `${name} where.userId`).toBe(userId);
                        }
                    }

                    // The upsert/create payloads must also stamp the requesting user as owner,
                    // so a freshly created row can never belong to another User.
                    for (const args of snapshotUpsert.mock.calls) {
                        const call = args[0] as {
                            where?: { userId?: string };
                            create?: { userId?: string };
                        };
                        expect(call.where?.userId).toBe(userId);
                        expect(call.create?.userId).toBe(userId);
                    }
                    for (const args of preferenceUpsert.mock.calls) {
                        const call = args[0] as {
                            where?: { userId?: string };
                            create?: { userId?: string };
                        };
                        expect(call.where?.userId).toBe(userId);
                        expect(call.create?.userId).toBe(userId);
                    }

                    // The system-supplied reference models are global per track and must NOT be
                    // user-scoped (scoping them by userId would wrongly hide shared data); they
                    // therefore cannot leak another user's *owned* rows.
                    for (const where of capturedWheres(questionTopicMapFindMany)) {
                        expect(where).not.toHaveProperty('userId');
                    }
                    for (const where of capturedWheres(topicFrequencyFindMany)) {
                        expect(where).not.toHaveProperty('userId');
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
