import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DB-independent tests for the study-block edit + delete handlers (task 6.6; design
 * "Timetable Generation Service", "Edit Validation"; Req 3.4, 3.5, 3.6, 3.7).
 *
 * Prisma is mocked so no live database is touched. We assert the handler contract:
 *   - a valid edit persists the new start/duration/subject (Req 3.4/3.6);
 *   - an edit that would overlap another study block OR a fixed commitment is rejected with
 *     409 and performs NO update, leaving the original unchanged (Req 3.5);
 *   - delete removes the block and returns 204 (Req 3.7);
 *   - per-user ownership: a missing block -> 404, another user's block -> 403;
 *   - the conflict check + update run inside a single transaction (atomicity).
 */
const {
    studyBlockFindUnique,
    studyBlockFindMany,
    studyBlockUpdate,
    studyBlockDelete,
    fixedCommitmentFindMany,
    transaction,
} = vi.hoisted(() => ({
    studyBlockFindUnique: vi.fn(),
    studyBlockFindMany: vi.fn(),
    studyBlockUpdate: vi.fn(),
    studyBlockDelete: vi.fn(),
    fixedCommitmentFindMany: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        studyBlock: {
            findUnique: studyBlockFindUnique,
            findMany: studyBlockFindMany,
            update: studyBlockUpdate,
            delete: studyBlockDelete,
        },
        fixedCommitment: { findMany: fixedCommitmentFindMany },
        $transaction: transaction,
    };
    return { default: prisma, prisma };
});

import { deleteBlockHandler, editBlockHandler } from './blockEditService';
import type { AuthContext } from '@/lib/auth';

const MON = '2026-01-05'; // Monday (UTC)

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function patchRequest(body: unknown): Request {
    return new Request('http://localhost/api/timetable/blocks/block-1', {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function routeCtx(id = 'block-1'): { params: { id: string } } {
    return { params: { id } };
}

/** Wire `$transaction` to run its callback against a tx client backed by the mocks. */
function wireTransaction(): void {
    transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
            studyBlock: { findMany: studyBlockFindMany, update: studyBlockUpdate },
            fixedCommitment: { findMany: fixedCommitmentFindMany },
        };
        return cb(tx);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    wireTransaction();
    // The block being edited: Monday 12:00–13:00, owned by user-1.
    studyBlockFindUnique.mockResolvedValue({
        id: 'block-1',
        userId: 'user-1',
        timetableId: 'tt-1',
        startTime: new Date(`${MON}T12:00:00.000Z`),
        durationMin: 60,
        subjectId: 'physics',
    });
    studyBlockFindMany.mockResolvedValue([]);
    fixedCommitmentFindMany.mockResolvedValue([]);
    studyBlockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'block-1',
        timetableId: 'tt-1',
        userId: 'user-1',
        ...data,
    }));
});

describe('editBlockHandler', () => {
    it('persists a valid edit that produces no overlap (Req 3.4/3.6)', async () => {
        // Move to 15:00–16:00, no peers, no commitments.
        const res = await editBlockHandler(
            patchRequest({ startTime: `${MON}T15:00:00.000Z`, durationMin: 60 }),
            authCtx(),
            routeCtx(),
        );
        expect(res.status).toBe(200);
        expect(studyBlockUpdate).toHaveBeenCalledWith({
            where: { id: 'block-1' },
            data: {
                startTime: new Date(`${MON}T15:00:00.000Z`),
                durationMin: 60,
                subjectId: 'physics',
            },
        });
        const body = (await res.json()) as { studyBlock: Record<string, unknown> };
        expect(body.studyBlock.startTime).toBeDefined();
    });

    it('applies a partial edit, keeping unspecified fields (Req 3.4)', async () => {
        const res = await editBlockHandler(
            patchRequest({ subjectId: 'maths' }),
            authCtx(),
            routeCtx(),
        );
        expect(res.status).toBe(200);
        expect(studyBlockUpdate).toHaveBeenCalledWith({
            where: { id: 'block-1' },
            data: {
                startTime: new Date(`${MON}T12:00:00.000Z`),
                durationMin: 60,
                subjectId: 'maths',
            },
        });
    });

    it('rejects the whole edit with 409 and does NOT update on overlap with another block (Req 3.5)', async () => {
        // A peer block at 14:30–15:30 collides with the proposed 15:00–16:00.
        studyBlockFindMany.mockResolvedValue([
            { startTime: new Date(`${MON}T14:30:00.000Z`), durationMin: 60 },
        ]);
        const res = await editBlockHandler(
            patchRequest({ startTime: `${MON}T15:00:00.000Z`, durationMin: 60 }),
            authCtx(),
            routeCtx(),
        );
        expect(res.status).toBe(409);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('TIMETABLE_OVERLAP');
        expect(studyBlockUpdate).not.toHaveBeenCalled();
    });

    it('rejects the whole edit with 409 on overlap with a fixed commitment (Req 3.5)', async () => {
        // Monday commitment 15:00–17:00 collides with the proposed 15:00–16:00.
        fixedCommitmentFindMany.mockResolvedValue([
            { dayOfWeek: 1, startTime: '15:00', endTime: '17:00' },
        ]);
        const res = await editBlockHandler(
            patchRequest({ startTime: `${MON}T15:00:00.000Z`, durationMin: 60 }),
            authCtx(),
            routeCtx(),
        );
        expect(res.status).toBe(409);
        expect(studyBlockUpdate).not.toHaveBeenCalled();
    });

    it('excludes the edited block itself from the peer overlap query', async () => {
        await editBlockHandler(
            patchRequest({ durationMin: 90 }),
            authCtx(),
            routeCtx(),
        );
        expect(studyBlockFindMany).toHaveBeenCalledWith({
            where: { timetableId: 'tt-1', id: { not: 'block-1' } },
            select: { startTime: true, durationMin: true },
        });
    });

    it('runs the conflict check and update inside a single transaction (atomicity)', async () => {
        await editBlockHandler(patchRequest({ durationMin: 90 }), authCtx(), routeCtx());
        expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when the block does not exist', async () => {
        studyBlockFindUnique.mockResolvedValue(null);
        const res = await editBlockHandler(patchRequest({ durationMin: 90 }), authCtx(), routeCtx());
        expect(res.status).toBe(404);
        expect(transaction).not.toHaveBeenCalled();
    });

    it("throws ForbiddenError for another user's block (mapped to 403 by withAuth)", async () => {
        studyBlockFindUnique.mockResolvedValue({
            id: 'block-1',
            userId: 'someone-else',
            timetableId: 'tt-1',
            startTime: new Date(`${MON}T12:00:00.000Z`),
            durationMin: 60,
            subjectId: 'physics',
        });
        await expect(
            editBlockHandler(patchRequest({ durationMin: 90 }), authCtx(), routeCtx()),
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
        expect(transaction).not.toHaveBeenCalled();
    });

    it('returns 422 for an invalid durationMin', async () => {
        const res = await editBlockHandler(patchRequest({ durationMin: -5 }), authCtx(), routeCtx());
        expect(res.status).toBe(422);
        expect(studyBlockFindUnique).not.toHaveBeenCalled();
    });

    it('returns 422 for an invalid startTime', async () => {
        const res = await editBlockHandler(
            patchRequest({ startTime: 'not-a-date' }),
            authCtx(),
            routeCtx(),
        );
        expect(res.status).toBe(422);
    });
});

describe('deleteBlockHandler', () => {
    it('removes the block and returns 204 (Req 3.7)', async () => {
        studyBlockFindUnique.mockResolvedValue({ id: 'block-1', userId: 'user-1' });
        const res = await deleteBlockHandler(new Request('http://localhost'), authCtx(), routeCtx());
        expect(res.status).toBe(204);
        expect(studyBlockDelete).toHaveBeenCalledWith({ where: { id: 'block-1' } });
    });

    it('returns 404 when the block does not exist', async () => {
        studyBlockFindUnique.mockResolvedValue(null);
        const res = await deleteBlockHandler(new Request('http://localhost'), authCtx(), routeCtx());
        expect(res.status).toBe(404);
        expect(studyBlockDelete).not.toHaveBeenCalled();
    });

    it("throws ForbiddenError for another user's block (mapped to 403 by withAuth)", async () => {
        studyBlockFindUnique.mockResolvedValue({ id: 'block-1', userId: 'someone-else' });
        await expect(
            deleteBlockHandler(new Request('http://localhost'), authCtx(), routeCtx()),
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
        expect(studyBlockDelete).not.toHaveBeenCalled();
    });
});
