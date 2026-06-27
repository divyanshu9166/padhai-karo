/**
 * Property-based test for the External Mock Score persistence round-trip (task 15.2;
 * design "External Mock Score endpoints (Req 1)").
 *
 *   - Property 2 (task 15.2): external mock score persistence round-trip (Req 1.1, 1.5).
 *
 * For any valid External_Mock_Score, creating it then reading it back yields a record equal
 * to the submitted (normalized) values associated with the submitting user; for any
 * subsequent valid edit, reading back yields the merged validated values; and a delete makes
 * the record absent.
 *
 * The service handlers (`createMockScoreHandler`, `listMockScoresHandler`,
 * `editMockScoreHandler`, `deleteMockScoreHandler`) are pure I/O orchestrators over a Prisma
 * client. To keep the property DB-free while still exercising the real create/list/edit/delete
 * flow, `@/lib/db` is replaced with an in-memory store for `externalMockScore` (keyed by `id`)
 * following the Phase 1 mocked-Prisma pattern (`vi.hoisted` + `vi.mock('@/lib/db')`, see
 * `services/pyq/coreTierAccess.property.test.ts`).
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- In-memory Prisma store --------------------------------------------------
// Faithful enough for the handlers: create assigns an id + timestamps, findMany scopes by
// userId, findUnique/update/delete key by id. testDate is stored as a Date (as the validator
// normalizes it), so JSON serialization in the handler responses matches real behavior.
const { db, store } = vi.hoisted(() => {
    interface Row {
        id: string;
        userId: string;
        source: string;
        sourceName: string | null;
        testDate: Date;
        obtainedScore: number;
        maxScore: number;
        createdAt: Date;
        updatedAt: Date;
    }
    const records = new Map<string, Row>();
    const state = { counter: 0 };

    const externalMockScore = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vi.fn(async ({ data }: any) => {
            state.counter += 1;
            const now = new Date();
            const row: Row = {
                id: `ems-${state.counter}`,
                createdAt: now,
                updatedAt: now,
                ...data,
            };
            records.set(row.id, row);
            return { ...row };
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: vi.fn(async ({ where }: any) => {
            const userId = where?.userId;
            return [...records.values()]
                .filter((r) => r.userId === userId)
                .map((r) => ({ ...r }));
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findUnique: vi.fn(async ({ where }: any) => {
            const row = records.get(where.id);
            return row ? { ...row } : null;
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: vi.fn(async ({ where, data }: any) => {
            const row = records.get(where.id);
            if (!row) throw new Error(`No ExternalMockScore with id ${where.id}`);
            const updated: Row = { ...row, ...data, updatedAt: new Date() };
            records.set(where.id, updated);
            return { ...updated };
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete: vi.fn(async ({ where }: any) => {
            const row = records.get(where.id);
            records.delete(where.id);
            return row ? { ...row } : null;
        }),
    };

    const db = { externalMockScore };
    return { db, store: { reset: () => records.clear() } };
});

vi.mock('@/lib/db', () => ({ default: db, prisma: db }));

import type { AuthContext } from '@/lib/auth';
import {
    createMockScoreHandler,
    deleteMockScoreHandler,
    editMockScoreHandler,
    listMockScoresHandler,
} from './mockScoreService';

// --- Helpers -----------------------------------------------------------------
function authCtx(userId: string): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function jsonReq(body: unknown): Request {
    return new Request('http://localhost/api/analytics/mock-scores', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

interface ScoreInput {
    source: 'ALLEN' | 'AAKASH' | 'OTHER';
    rawSourceName: string;
    testDate: Date;
    maxScore: number;
    fraction: number;
}

/** The request body the handler receives for an input. */
function bodyOf(input: ScoreInput) {
    return {
        source: input.source,
        // A leading 's' guarantees the trimmed label is non-blank (required for OTHER).
        sourceName: `s${input.rawSourceName}`,
        testDate: input.testDate.toISOString(),
        obtainedScore: input.fraction * input.maxScore,
        maxScore: input.maxScore,
    };
}

/** The persisted/normalized projection expected after the validator runs on an input. */
function normalizedOf(input: ScoreInput) {
    return {
        source: input.source,
        sourceName: input.source === 'OTHER' ? `s${input.rawSourceName}`.trim() : null,
        testDateISO: input.testDate.toISOString(),
        obtainedScore: input.fraction * input.maxScore,
        maxScore: input.maxScore,
    };
}

type Persisted = {
    id: string;
    userId: string;
    source: string;
    sourceName: string | null;
    testDate: string;
    obtainedScore: number;
    maxScore: number;
};

async function readBack(userId: string, id: string): Promise<Persisted | undefined> {
    const res = await listMockScoresHandler(jsonReq({}), authCtx(userId));
    const { mockScores } = (await res.json()) as { mockScores: Persisted[] };
    return mockScores.find((m) => m.id === id);
}

// --- Generators --------------------------------------------------------------
const validInputArb: fc.Arbitrary<ScoreInput> = fc.record({
    source: fc.constantFrom('ALLEN', 'AAKASH', 'OTHER') as fc.Arbitrary<ScoreInput['source']>,
    rawSourceName: fc.string({ minLength: 1, maxLength: 12 }),
    testDate: fc.date({
        min: new Date('2000-01-01T00:00:00.000Z'),
        max: new Date(Date.now() - 24 * 60 * 60 * 1000),
        noInvalidDate: true,
    }),
    maxScore: fc.double({ min: 0.5, max: 1000, noNaN: true, noDefaultInfinity: true }),
    fraction: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
});

/** Which logical field groups a valid edit patches; an absent group retains the stored value. */
const editFlagsArb = fc.record({
    source: fc.boolean(),
    testDate: fc.boolean(),
    scores: fc.boolean(),
});

beforeEach(() => {
    store.reset();
    vi.clearAllMocks();
});

describe('external mock score persistence round-trip', () => {
    // Feature: performance-analytics, Property 2: External mock score persistence round-trip
    // — for any valid external mock score, create-then-read yields the submitted normalized
    // values for the submitting user; a subsequent valid edit reads back the merged values;
    // a delete makes the record absent.
    // Validates: Requirements 1.1, 1.5
    it('Property 2: create persists, edit merges, delete removes (Req 1.1, 1.5)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                validInputArb,
                validInputArb,
                editFlagsArb,
                async (userId, createInput, editInput, flags) => {
                    store.reset();

                    // --- CREATE: persist and read it back (Req 1.1) ---
                    const created = normalizedOf(createInput);
                    const createRes = await createMockScoreHandler(
                        jsonReq(bodyOf(createInput)),
                        authCtx(userId),
                    );
                    expect(createRes.status).toBe(201);
                    const { mockScore } = (await createRes.json()) as { mockScore: Persisted };
                    const id = mockScore.id;

                    const afterCreate = await readBack(userId, id);
                    expect(afterCreate).toBeDefined();
                    // Associated with the submitting user.
                    expect(afterCreate?.userId).toBe(userId);
                    expect(afterCreate?.source).toBe(created.source);
                    expect(afterCreate?.sourceName).toBe(created.sourceName);
                    expect(afterCreate?.testDate).toBe(created.testDateISO);
                    expect(afterCreate?.obtainedScore).toBe(created.obtainedScore);
                    expect(afterCreate?.maxScore).toBe(created.maxScore);

                    // --- EDIT: merge a valid patch and read back the merged values (Req 1.5) ---
                    const editNorm = normalizedOf(editInput);
                    const patch: Record<string, unknown> = {};
                    if (flags.source) {
                        patch.source = editInput.source;
                        patch.sourceName = `s${editInput.rawSourceName}`;
                    }
                    if (flags.testDate) {
                        patch.testDate = editInput.testDate.toISOString();
                    }
                    if (flags.scores) {
                        patch.obtainedScore = editInput.fraction * editInput.maxScore;
                        patch.maxScore = editInput.maxScore;
                    }

                    const expectedMerged = {
                        source: flags.source ? editNorm.source : created.source,
                        sourceName: flags.source ? editNorm.sourceName : created.sourceName,
                        testDateISO: flags.testDate ? editNorm.testDateISO : created.testDateISO,
                        obtainedScore: flags.scores
                            ? editNorm.obtainedScore
                            : created.obtainedScore,
                        maxScore: flags.scores ? editNorm.maxScore : created.maxScore,
                    };

                    const editRes = await editMockScoreHandler(
                        jsonReq(patch),
                        authCtx(userId),
                        { params: { id } },
                    );
                    expect(editRes.status).toBe(200);

                    const afterEdit = await readBack(userId, id);
                    expect(afterEdit).toBeDefined();
                    expect(afterEdit?.source).toBe(expectedMerged.source);
                    expect(afterEdit?.sourceName).toBe(expectedMerged.sourceName);
                    expect(afterEdit?.testDate).toBe(expectedMerged.testDateISO);
                    expect(afterEdit?.obtainedScore).toBe(expectedMerged.obtainedScore);
                    expect(afterEdit?.maxScore).toBe(expectedMerged.maxScore);

                    // --- DELETE: the record becomes absent ---
                    const deleteRes = await deleteMockScoreHandler(
                        jsonReq({}),
                        authCtx(userId),
                        { params: { id } },
                    );
                    expect(deleteRes.status).toBe(204);

                    const afterDelete = await readBack(userId, id);
                    expect(afterDelete).toBeUndefined();
                },
            ),
            { numRuns: 100 },
        );
    });
});
