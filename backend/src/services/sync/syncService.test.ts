import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the offline-sync handler (task 18.1).
 *
 * Everything runs against a mocked Prisma client so we never touch a live database. We
 * prove the idempotency contract the task specifies (Req 21.5):
 *   - a record whose (userId, clientId) already exists returns DUPLICATE with the existing
 *     serverId and creates NOTHING;
 *   - a new clientId creates the target row + ledger row (in a transaction) and returns
 *     CREATED with the canonical serverId and server-computed score;
 *   - distinct clientIds create distinct records;
 *   - a repeated clientId within the same batch reconciles to DUPLICATE;
 *   - the unique-constraint (P2002) concurrency backstop resolves to DUPLICATE.
 *
 * The numbered property test (Property 47) is task 18.2.
 *
 * Validates: Requirements 21.5
 */

// --- Prisma mock -------------------------------------------------------------
const {
    findManyLedger,
    findUniqueLedger,
    createLedger,
    createFocusSession,
    createPyqAttempt,
    createTimedAttempt,
    findManyPyq,
    txMock,
} = vi.hoisted(() => {
    const m = {
        findManyLedger: vi.fn(),
        findUniqueLedger: vi.fn(),
        createLedger: vi.fn(),
        createFocusSession: vi.fn(),
        createPyqAttempt: vi.fn(),
        createTimedAttempt: vi.fn(),
        findManyPyq: vi.fn(),
        txMock: vi.fn(),
    };
    return m;
});

vi.mock('@/lib/db', () => {
    const prisma = {
        localSyncRecord: {
            findMany: findManyLedger,
            findUnique: findUniqueLedger,
            create: createLedger,
        },
        focusSession: { create: createFocusSession },
        pYQAttempt: { create: createPyqAttempt },
        timedPaperAttempt: { create: createTimedAttempt },
        pYQ: { findMany: findManyPyq },
        $transaction: txMock,
    };
    return { default: prisma, prisma };
});

import { syncHandler } from './syncService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/sync', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/** A valid focus-session payload (validates against the shared focus validator). */
function focusPayload(overrides: Record<string, unknown> = {}) {
    return {
        subjectId: 'subj-1',
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T11:00:00.000Z',
        focusedDurationMin: 50,
        ...overrides,
    };
}

beforeEach(() => {
    findManyLedger.mockReset();
    findUniqueLedger.mockReset();
    createLedger.mockReset();
    createFocusSession.mockReset();
    createPyqAttempt.mockReset();
    createTimedAttempt.mockReset();
    findManyPyq.mockReset();
    txMock.mockReset();
    // The transaction simply runs its callback with the same mocked client as `tx`.
    const tx = {
        localSyncRecord: { create: createLedger },
        focusSession: { create: createFocusSession },
        pYQAttempt: { create: createPyqAttempt },
        timedPaperAttempt: { create: createTimedAttempt },
    };
    txMock.mockImplementation(async (cb: (client: typeof tx) => unknown) => cb(tx));
    createLedger.mockResolvedValue({ id: 'ledger-x' });
});

describe('syncHandler validation', () => {
    it('returns 422 when the body is not an object', async () => {
        const res = await syncHandler(
            new Request('http://localhost/api/sync', { method: 'POST', body: 'oops' }),
            authCtx(),
        );
        expect(res.status).toBe(422);
        expect(findManyLedger).not.toHaveBeenCalled();
    });

    it('returns 422 when records is missing', async () => {
        const res = await syncHandler(postReq({}), authCtx());
        expect(res.status).toBe(422);
    });

    it('returns 422 when a record payload is invalid', async () => {
        const res = await syncHandler(
            postReq({
                records: [
                    { clientId: 'c-1', type: 'FOCUS_SESSION', payload: focusPayload({ subjectId: '' }) },
                ],
            }),
            authCtx(),
        );
        expect(res.status).toBe(422);
        expect(createFocusSession).not.toHaveBeenCalled();
    });
});

describe('syncHandler idempotency (Req 21.5)', () => {
    it('returns DUPLICATE with the existing serverId and creates nothing when the clientId is already synced', async () => {
        // Ledger already has this (userId, clientId).
        findManyLedger.mockResolvedValue([{ clientId: 'c-1', serverId: 'fs-existing' }]);

        const res = await syncHandler(
            postReq({
                records: [{ clientId: 'c-1', type: 'FOCUS_SESSION', payload: focusPayload() }],
            }),
            authCtx('user-7'),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { results: Array<Record<string, unknown>> };
        expect(body.results).toEqual([
            { clientId: 'c-1', serverId: 'fs-existing', status: 'DUPLICATE' },
        ]);

        // Nothing was created.
        expect(createFocusSession).not.toHaveBeenCalled();
        expect(createLedger).not.toHaveBeenCalled();
        expect(txMock).not.toHaveBeenCalled();
    });

    it('creates the target + ledger and returns CREATED for a new clientId', async () => {
        findManyLedger.mockResolvedValue([]);
        createFocusSession.mockResolvedValue({ id: 'fs-1' });

        const res = await syncHandler(
            postReq({
                records: [{ clientId: 'c-1', type: 'FOCUS_SESSION', payload: focusPayload() }],
            }),
            authCtx('user-7'),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { results: Array<Record<string, unknown>> };
        expect(body.results).toEqual([
            { clientId: 'c-1', serverId: 'fs-1', status: 'CREATED' },
        ]);

        // Target row created scoped to the user, ledger row written with the server id.
        expect(createFocusSession).toHaveBeenCalledTimes(1);
        const fsArg = createFocusSession.mock.calls[0][0];
        expect(fsArg.data.userId).toBe('user-7');
        expect(fsArg.data.clientId).toBe('c-1');

        expect(createLedger).toHaveBeenCalledTimes(1);
        expect(createLedger.mock.calls[0][0].data).toMatchObject({
            userId: 'user-7',
            clientId: 'c-1',
            type: 'FOCUS_SESSION',
            serverId: 'fs-1',
        });
    });

    it('computes the authoritative PYQ score server-side and returns it with CREATED', async () => {
        findManyLedger.mockResolvedValue([]);
        // Server-side answer key resolved from the DB (NOT trusted from the client).
        findManyPyq.mockResolvedValue([
            { id: 'q1', correctOption: 0 },
            { id: 'q2', correctOption: 1 },
        ]);
        createPyqAttempt.mockResolvedValue({ id: 'pa-1' });

        const res = await syncHandler(
            postReq({
                records: [
                    {
                        clientId: 'c-pyq',
                        type: 'PYQ_ATTEMPT',
                        payload: {
                            paperOrSetRef: 'jee-2024',
                            answers: [
                                { questionId: 'q1', selectedOption: 0 }, // correct
                                { questionId: 'q2', selectedOption: 3 }, // incorrect
                            ],
                            // Client tries to sneak a correct answer; it must be ignored.
                            correctOption: 3,
                        },
                    },
                ],
            }),
            authCtx('user-7'),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { results: Array<Record<string, unknown>> };
        expect(body.results).toEqual([
            { clientId: 'c-pyq', serverId: 'pa-1', status: 'CREATED', score: 1 },
        ]);
        expect(createPyqAttempt.mock.calls[0][0].data.totalScore).toBe(1);
    });

    it('creates distinct records for distinct clientIds', async () => {
        findManyLedger.mockResolvedValue([]);
        createFocusSession
            .mockResolvedValueOnce({ id: 'fs-1' })
            .mockResolvedValueOnce({ id: 'fs-2' });

        const res = await syncHandler(
            postReq({
                records: [
                    { clientId: 'c-1', type: 'FOCUS_SESSION', payload: focusPayload() },
                    { clientId: 'c-2', type: 'FOCUS_SESSION', payload: focusPayload() },
                ],
            }),
            authCtx('user-7'),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { results: Array<Record<string, unknown>> };
        expect(body.results).toEqual([
            { clientId: 'c-1', serverId: 'fs-1', status: 'CREATED' },
            { clientId: 'c-2', serverId: 'fs-2', status: 'CREATED' },
        ]);
        expect(createFocusSession).toHaveBeenCalledTimes(2);
        expect(createLedger).toHaveBeenCalledTimes(2);
    });

    it('reconciles a repeated clientId within the same batch to DUPLICATE (one create only)', async () => {
        findManyLedger.mockResolvedValue([]);
        createFocusSession.mockResolvedValue({ id: 'fs-1' });

        const res = await syncHandler(
            postReq({
                records: [
                    { clientId: 'dup', type: 'FOCUS_SESSION', payload: focusPayload() },
                    { clientId: 'dup', type: 'FOCUS_SESSION', payload: focusPayload() },
                ],
            }),
            authCtx('user-7'),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { results: Array<Record<string, unknown>> };
        expect(body.results).toEqual([
            { clientId: 'dup', serverId: 'fs-1', status: 'CREATED' },
            { clientId: 'dup', serverId: 'fs-1', status: 'DUPLICATE' },
        ]);
        // Only ONE create happened despite the repeated clientId.
        expect(createFocusSession).toHaveBeenCalledTimes(1);
        expect(createLedger).toHaveBeenCalledTimes(1);
    });

    it('treats a unique-constraint race (P2002) as DUPLICATE via the ledger backstop', async () => {
        findManyLedger.mockResolvedValue([]);
        // The create races and loses to a concurrent insert.
        createFocusSession.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', {
                code: 'P2002',
                clientVersion: 'test',
            }),
        );
        // The ledger row now exists (written by the winning request).
        findUniqueLedger.mockResolvedValue({ serverId: 'fs-winner' });

        const res = await syncHandler(
            postReq({
                records: [{ clientId: 'c-race', type: 'FOCUS_SESSION', payload: focusPayload() }],
            }),
            authCtx('user-7'),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { results: Array<Record<string, unknown>> };
        expect(body.results).toEqual([
            { clientId: 'c-race', serverId: 'fs-winner', status: 'DUPLICATE' },
        ]);
    });
});
