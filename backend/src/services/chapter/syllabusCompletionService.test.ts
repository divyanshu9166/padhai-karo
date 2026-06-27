/**
 * Example (DB-independent) tests for the syllabus completion handler (task 5.3).
 *
 * The handler is exercised against a mocked Prisma client so we never touch a live
 * database. We assert the behaviour the task specifies: the query is scoped to the
 * authenticated user's id (per-user isolation), the returned `percent` equals the shared
 * pure computation over the loaded statuses (Req 12.4), and zero chapters yields 0
 * (Req 12.5).
 *
 * Validates: Requirements 12.4, 12.5
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const { findManyChapter } = vi.hoisted(() => ({
    findManyChapter: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        chapter: { findMany: findManyChapter },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';

import { getSyllabusCompletionHandler } from './syllabusCompletionService';

function authCtx(userId = 'user-1'): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function getReq(): Request {
    return new Request('http://localhost/api/syllabus/completion');
}

beforeEach(() => {
    findManyChapter.mockReset();
});

describe('getSyllabusCompletionHandler', () => {
    it('scopes the chapter query to the authenticated user', async () => {
        findManyChapter.mockResolvedValue([]);

        await getSyllabusCompletionHandler(getReq(), authCtx('user-42'));

        expect(findManyChapter).toHaveBeenCalledTimes(1);
        const arg = findManyChapter.mock.calls[0][0];
        expect(arg.where).toEqual({ userId: 'user-42' });
        // Only the status column is needed for the computation.
        expect(arg.select).toEqual({ status: true });
    });

    it('returns 0 when the user has zero chapters (Req 12.5)', async () => {
        findManyChapter.mockResolvedValue([]);

        const res = await getSyllabusCompletionHandler(getReq(), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as { percent: number };
        expect(body.percent).toBe(0);
    });

    it('returns the computed percent of DONE/REVISED over total chapters (Req 12.4)', async () => {
        // 2 of 4 completed (DONE + REVISED) -> 50%.
        findManyChapter.mockResolvedValue([
            { status: 'DONE' },
            { status: 'REVISED' },
            { status: 'IN_PROGRESS' },
            { status: 'NOT_STARTED' },
        ]);

        const res = await getSyllabusCompletionHandler(getReq(), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as { percent: number };
        expect(body.percent).toBe(50);
    });

    it('rounds to two decimals for non-terminating ratios (1 of 3 -> 33.33)', async () => {
        findManyChapter.mockResolvedValue([
            { status: 'DONE' },
            { status: 'IN_PROGRESS' },
            { status: 'NOT_STARTED' },
        ]);

        const res = await getSyllabusCompletionHandler(getReq(), authCtx());

        const body = (await res.json()) as { percent: number };
        expect(body.percent).toBe(33.33);
    });

    it('returns 100 when every chapter is DONE or REVISED', async () => {
        findManyChapter.mockResolvedValue([
            { status: 'DONE' },
            { status: 'REVISED' },
        ]);

        const res = await getSyllabusCompletionHandler(getReq(), authCtx());

        const body = (await res.json()) as { percent: number };
        expect(body.percent).toBe(100);
    });
});
