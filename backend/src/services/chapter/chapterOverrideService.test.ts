/**
 * Example (DB-independent) tests for the chapter override handlers (task 5.2).
 *
 * The handlers are exercised against a mocked Prisma client so we never touch a live
 * database. We assert the behaviour the task specifies: positive-number validation (422),
 * partial persistence of only the provided fields (Req 11.3), clearing all overrides on
 * DELETE (Req 11.4), and per-user ownership (404 missing / 403 cross-user).
 *
 * Validates: Requirements 11.3, 11.4
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const { findUniqueChapter, updateChapter } = vi.hoisted(() => ({
    findUniqueChapter: vi.fn(),
    updateChapter: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        chapter: { findUnique: findUniqueChapter, update: updateChapter },
    };
    return { default: prisma, prisma };
});

import { ForbiddenError } from '@/lib/auth';
import type { AuthContext } from '@/lib/auth';

import {
    clearChapterOverrideHandler,
    updateChapterOverrideHandler,
} from './chapterOverrideService';

function authCtx(userId = 'user-1'): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function patchReq(body: unknown): Request {
    return new Request('http://localhost/api/chapters/ch-1/override', {
        method: 'PATCH',
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

function deleteReq(): Request {
    return new Request('http://localhost/api/chapters/ch-1/override', { method: 'DELETE' });
}

beforeEach(() => {
    findUniqueChapter.mockReset();
    updateChapter.mockReset();
});

describe('updateChapterOverrideHandler', () => {
    it('returns 422 for an invalid (non-positive) override without touching the DB', async () => {
        const res = await updateChapterOverrideHandler(
            patchReq({ weightageOverride: -3 }),
            authCtx(),
            'ch-1',
        );
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(findUniqueChapter).not.toHaveBeenCalled();
        expect(updateChapter).not.toHaveBeenCalled();
    });

    it('returns 422 when no override field is provided', async () => {
        const res = await updateChapterOverrideHandler(patchReq({}), authCtx(), 'ch-1');
        expect(res.status).toBe(422);
        expect(updateChapter).not.toHaveBeenCalled();
    });

    it('returns 422 when the JSON body is not an object', async () => {
        const res = await updateChapterOverrideHandler(patchReq('oops'), authCtx(), 'ch-1');
        expect(res.status).toBe(422);
        expect(findUniqueChapter).not.toHaveBeenCalled();
    });

    it('persists only the provided fields scoped to the owner and returns 200', async () => {
        findUniqueChapter.mockResolvedValue({ id: 'ch-1', userId: 'user-42' });
        updateChapter.mockResolvedValue({ id: 'ch-1', estHoursOverride: 9 });

        const res = await updateChapterOverrideHandler(
            patchReq({ estHoursOverride: 9 }),
            authCtx('user-42'),
            'ch-1',
        );

        expect(res.status).toBe(200);
        expect(updateChapter).toHaveBeenCalledTimes(1);
        const arg = updateChapter.mock.calls[0][0];
        expect(arg.where).toEqual({ id: 'ch-1' });
        // Partial update: only the provided field is in `data`.
        expect(arg.data).toEqual({ estHoursOverride: 9 });

        const body = (await res.json()) as { chapter: { id: string } };
        expect(body.chapter.id).toBe('ch-1');
    });

    it('persists all three override fields when provided', async () => {
        findUniqueChapter.mockResolvedValue({ id: 'ch-1', userId: 'user-1' });
        updateChapter.mockResolvedValue({ id: 'ch-1' });

        await updateChapterOverrideHandler(
            patchReq({
                weightageOverride: 7,
                estHoursOverride: 12,
                timeAllocationOverride: 3,
            }),
            authCtx('user-1'),
            'ch-1',
        );

        expect(updateChapter.mock.calls[0][0].data).toEqual({
            weightageOverride: 7,
            estHoursOverride: 12,
            timeAllocationOverride: 3,
        });
    });

    it('returns 404 for a missing chapter', async () => {
        findUniqueChapter.mockResolvedValue(null);
        const res = await updateChapterOverrideHandler(
            patchReq({ weightageOverride: 5 }),
            authCtx('user-1'),
            'ch-1',
        );
        expect(res.status).toBe(404);
        expect(updateChapter).not.toHaveBeenCalled();
    });

    it("throws ForbiddenError (→ 403) for another user's chapter", async () => {
        findUniqueChapter.mockResolvedValue({ id: 'ch-1', userId: 'other-user' });
        await expect(
            updateChapterOverrideHandler(
                patchReq({ weightageOverride: 5 }),
                authCtx('user-1'),
                'ch-1',
            ),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(updateChapter).not.toHaveBeenCalled();
    });
});

describe('clearChapterOverrideHandler', () => {
    it('clears all override fields and returns 204', async () => {
        findUniqueChapter.mockResolvedValue({ id: 'ch-1', userId: 'user-1' });
        updateChapter.mockResolvedValue({ id: 'ch-1' });

        const res = await clearChapterOverrideHandler(deleteReq(), authCtx('user-1'), 'ch-1');

        expect(res.status).toBe(204);
        expect(updateChapter).toHaveBeenCalledTimes(1);
        expect(updateChapter.mock.calls[0][0]).toEqual({
            where: { id: 'ch-1' },
            data: {
                weightageOverride: null,
                estHoursOverride: null,
                timeAllocationOverride: null,
            },
        });
        // 204 carries no body.
        expect(await res.text()).toBe('');
    });

    it('returns 404 for a missing chapter', async () => {
        findUniqueChapter.mockResolvedValue(null);
        const res = await clearChapterOverrideHandler(deleteReq(), authCtx('user-1'), 'ch-1');
        expect(res.status).toBe(404);
        expect(updateChapter).not.toHaveBeenCalled();
    });

    it("throws ForbiddenError (→ 403) for another user's chapter", async () => {
        findUniqueChapter.mockResolvedValue({ id: 'ch-1', userId: 'other-user' });
        await expect(
            clearChapterOverrideHandler(deleteReq(), authCtx('user-1'), 'ch-1'),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(updateChapter).not.toHaveBeenCalled();
    });
});
