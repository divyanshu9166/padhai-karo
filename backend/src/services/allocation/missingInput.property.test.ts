/**
 * Property-based test for the missing-input / reference-data-unavailable posture of the
 * Allocation_Service handlers (task 13.3; design "Correctness Properties → Property 14").
 *
 *   - Property 14: Missing required inputs yield a missing-input response and no output
 *     Validates: Requirements 2.4, 3.7, 9.5
 *
 * Property 14 (design statement): For any request whose required inputs are absent — in
 * particular when no `TopicFrequencyReferenceData` exists for the User's track — the service
 * produces no `Combined_Weightage_Signal` or `Suggested_Time_Allocation`, returns a response
 * indicating the reference-data-unavailable / missing-input condition, and leaves all existing
 * records unchanged.
 *
 * The three read handlers (`signalHandler`, `mostFrequentChaptersHandler`,
 * `suggestedAllocationHandler`) share the same missing-input contract:
 *   - When `resolveActiveReferenceYear(track, TOPIC_FREQUENCY)` returns `null` (no
 *     topic-frequency dataset for the track), the handler returns `503
 *     REFERENCE_DATA_UNAVAILABLE` and computes no allocation output (Req 2.4, 3.7, 9.5).
 *   - When the User has no `Profile` (not onboarded), the handler returns `404 NOT_FOUND`
 *     before any reference resolution or computation runs.
 * In both branches no allocation payload (`chapters` / `allocations`) is present, and the only
 * write this feature performs — the `SuggestedAllocationSnapshot` upsert — is never reached, so
 * existing records are left unchanged (Req 9.5).
 *
 * Following the established analytics service-test convention (see
 * `topicPriorityService.test.ts`): Prisma is mocked through `vi.hoisted` + `vi.mock('@/lib/db')`,
 * and the active-version resolver is mocked directly via
 * `vi.mock('@/lib/analytics/referenceVersion')` so each generated condition controls exactly
 * whether the required reference data is "present" or "absent" without standing up a database.
 *
 * fast-check assertions run a minimum of 100 iterations each.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
// Every read the handlers might reach plus the single write (snapshot upsert) is a spy, so the
// test can assert the missing-input branches neither read user data nor mutate any record.
const {
    profileFindUnique,
    chapterFindMany,
    pyqAttemptFindMany,
    questionTopicMapFindMany,
    topicFrequencyFindMany,
    snapshotUpsert,
} = vi.hoisted(() => ({
    profileFindUnique: vi.fn(),
    chapterFindMany: vi.fn(),
    pyqAttemptFindMany: vi.fn(),
    questionTopicMapFindMany: vi.fn(),
    topicFrequencyFindMany: vi.fn(),
    snapshotUpsert: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        chapter: { findMany: chapterFindMany },
        pYQAttempt: { findMany: pyqAttemptFindMany },
        questionTopicMap: { findMany: questionTopicMapFindMany },
        topicFrequencyReferenceData: { findMany: topicFrequencyFindMany },
        suggestedAllocationSnapshot: { upsert: snapshotUpsert },
    };
    return { default: prisma, prisma };
});

// Mock the shared active-version resolver directly so each iteration decides whether the
// topic-frequency dataset is present (a year) or absent (`null`).
const { resolveActiveReferenceYearMock } = vi.hoisted(() => ({
    resolveActiveReferenceYearMock: vi.fn(),
}));

vi.mock('@/lib/analytics/referenceVersion', () => ({
    resolveActiveReferenceYear: resolveActiveReferenceYearMock,
}));

import type { AuthContext } from '@/lib/auth';
import { ErrorCode } from '@/lib/errors';

import { signalHandler } from './signalService';
import { mostFrequentChaptersHandler } from './mostFrequentService';
import { suggestedAllocationHandler } from './suggestedAllocationService';

type AllocationHandler = (request: Request, ctx: AuthContext) => Promise<Response>;

/** The three Allocation_Service read handlers that share the missing-input contract. */
const HANDLERS: ReadonlyArray<{ name: string; handler: AllocationHandler; path: string }> = [
    { name: 'signal', handler: signalHandler, path: '/api/allocation/signal' },
    {
        name: 'most-frequent-chapters',
        handler: mostFrequentChaptersHandler,
        path: '/api/allocation/most-frequent-chapters',
    },
    {
        name: 'suggested-allocation',
        handler: suggestedAllocationHandler,
        path: '/api/allocation/suggested-allocation',
    },
];

function authCtx(userId: string): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function getReq(path: string): Request {
    return new Request(`http://localhost${path}`, { method: 'GET' });
}

/** Reset every spy so each generated condition starts from a clean slate. */
function resetSpies(): void {
    profileFindUnique.mockReset();
    chapterFindMany.mockReset();
    pyqAttemptFindMany.mockReset();
    questionTopicMapFindMany.mockReset();
    topicFrequencyFindMany.mockReset();
    snapshotUpsert.mockReset();
    resolveActiveReferenceYearMock.mockReset();
}

/** Assert a parsed JSON body carries no allocation output payload (Req 3.7, 9.5). */
function expectNoAllocationOutput(body: unknown): void {
    expect(body).not.toHaveProperty('chapters');
    expect(body).not.toHaveProperty('allocations');
    expect(body).not.toHaveProperty('referenceDataYear');
}

/** Assert no user-data read and no write occurred (existing records left unchanged). */
function expectNoMutation(): void {
    expect(snapshotUpsert).not.toHaveBeenCalled();
    expect(chapterFindMany).not.toHaveBeenCalled();
    expect(pyqAttemptFindMany).not.toHaveBeenCalled();
    expect(questionTopicMapFindMany).not.toHaveBeenCalled();
    expect(topicFrequencyFindMany).not.toHaveBeenCalled();
}

const examTrackArb = fc.constantFrom('JEE', 'NEET');
const tierArb = fc.constantFrom('FREE', 'PAID');
const languageArb = fc.constantFrom('EN', 'HI');
const userIdArb = fc.uuid();

beforeEach(() => {
    resetSpies();
});

describe('Allocation_Service missing-input handling (Property 14)', () => {
    // Feature: weightage-based-time-allocation, Property 14: Missing required inputs yield a
    // missing-input response and no output
    it('Property 14: absent reference data yields 503 REFERENCE_DATA_UNAVAILABLE and no output (Req 2.4, 3.7, 9.5)', async () => {
        await fc.assert(
            fc.asyncProperty(
                examTrackArb,
                tierArb,
                languageArb,
                userIdArb,
                fc.constantFrom(...HANDLERS.map((_, index) => index)),
                async (examTrack, subscriptionTier, language, userId, handlerIndex) => {
                    resetSpies();

                    // The User IS onboarded (a profile exists) ...
                    profileFindUnique.mockResolvedValue({
                        examTrack,
                        language,
                        subscriptionTier,
                    });
                    // ... but NO topic-frequency dataset exists for the track: the required
                    // reference input is absent (Req 2.4, 9.5).
                    resolveActiveReferenceYearMock.mockResolvedValue(null);

                    const { handler, path } = HANDLERS[handlerIndex];
                    const response = await handler(getReq(path), authCtx(userId));

                    // The service indicates the reference-data-unavailable condition (Req 3.7).
                    expect(response.status).toBe(503);
                    const body = await response.json();
                    expect(body.error.code).toBe(ErrorCode.REFERENCE_DATA_UNAVAILABLE);

                    // No Combined_Weightage_Signal / Suggested_Time_Allocation is produced.
                    expectNoAllocationOutput(body);

                    // All existing records are left unchanged: no user-data read, no write.
                    expectNoMutation();
                },
            ),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 14: Missing required inputs yield a
    // missing-input response and no output
    it('Property 14: a missing Profile yields 404 NOT_FOUND and no output (Req 9.5)', async () => {
        await fc.assert(
            fc.asyncProperty(
                userIdArb,
                fc.constantFrom(...HANDLERS.map((_, index) => index)),
                async (userId, handlerIndex) => {
                    resetSpies();

                    // The required per-user input (the Profile) is absent: the user is not
                    // onboarded, so the handler cannot select a track or compute any output.
                    profileFindUnique.mockResolvedValue(null);
                    // Make the resolver throw if reached — a missing profile must short-circuit
                    // before any reference resolution.
                    resolveActiveReferenceYearMock.mockRejectedValue(
                        new Error('resolveActiveReferenceYear must not run without a profile'),
                    );

                    const { handler, path } = HANDLERS[handlerIndex];
                    const response = await handler(getReq(path), authCtx(userId));

                    expect(response.status).toBe(404);
                    const body = await response.json();
                    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);

                    // No allocation output and no mutation of any record.
                    expectNoAllocationOutput(body);
                    expectNoMutation();
                    expect(resolveActiveReferenceYearMock).not.toHaveBeenCalled();
                },
            ),
            { numRuns: 100 },
        );
    });
});
