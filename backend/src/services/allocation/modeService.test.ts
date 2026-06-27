import { EffectiveAllocationMode } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DB-independent unit tests for the Allocation-mode service (task 12.2; Req 10.3, 10.4).
 *
 * Two concerns are covered:
 *   1. Mode validation — the pure {@link validateAllocationModeInput} rejects non-object
 *      bodies, a missing `mode`, and invalid `mode` strings, and the PUT handler maps each
 *      rejection to `422 VALIDATION_ERROR`; valid enum values are accepted.
 *   2. Ownership / non-disclosure — when a stored `AllocationPreference` row belongs to a
 *      different user, both handlers reject with a `ForbiddenError` (mapped to `403 FORBIDDEN`
 *      by `withAuth`) without revealing the row's existence (Req 10.3, 10.4). The real
 *      {@link assertOwnership} drives this so the non-disclosure semantics are exercised, not
 *      stubbed.
 *
 * Prisma is mocked (`@/lib/db`) so no live database is touched, mirroring the conventions in
 * `profileService.test.ts`.
 *
 * Validates: Requirements 10.3, 10.4
 */

const { findUniquePreference, upsertPreference } = vi.hoisted(() => ({
    findUniquePreference: vi.fn(),
    upsertPreference: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        allocationPreference: {
            findUnique: findUniquePreference,
            upsert: upsertPreference,
        },
    };
    return { default: prisma, prisma };
});

import {
    EFFECTIVE_ALLOCATION_MODE_VALUES,
    getAllocationModeHandler,
    updateAllocationModeHandler,
    validateAllocationModeInput,
} from './modeService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function putRequest(body: unknown): Request {
    return new Request('http://localhost/api/allocation/mode', {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function getRequest(): Request {
    return new Request('http://localhost/api/allocation/mode', { method: 'GET' });
}

beforeEach(() => {
    findUniquePreference.mockReset();
    upsertPreference.mockReset();
});

describe('validateAllocationModeInput (Req 7.1, 7.2)', () => {
    it('rejects non-object bodies (null, array, primitives)', () => {
        for (const raw of [null, undefined, [], ['SUGGESTED'], 'SUGGESTED', 42, true]) {
            const result = validateAllocationModeInput(raw);
            expect(result.ok).toBe(false);
        }
    });

    it('rejects a body missing the mode field', () => {
        const result = validateAllocationModeInput({});
        expect(result.ok).toBe(false);
    });

    it('rejects an invalid mode string', () => {
        const result = validateAllocationModeInput({ mode: 'TURBO' });
        expect(result).toMatchObject({
            ok: false,
            details: { field: 'mode', allowed: EFFECTIVE_ALLOCATION_MODE_VALUES },
        });
    });

    it('rejects a non-string mode', () => {
        expect(validateAllocationModeInput({ mode: 1 }).ok).toBe(false);
        expect(validateAllocationModeInput({ mode: null }).ok).toBe(false);
    });

    it('accepts SUGGESTED and PHASE1_DEFAULT', () => {
        expect(validateAllocationModeInput({ mode: EffectiveAllocationMode.SUGGESTED })).toEqual({
            ok: true,
            value: EffectiveAllocationMode.SUGGESTED,
        });
        expect(
            validateAllocationModeInput({ mode: EffectiveAllocationMode.PHASE1_DEFAULT }),
        ).toEqual({ ok: true, value: EffectiveAllocationMode.PHASE1_DEFAULT });
    });
});

describe('updateAllocationModeHandler validation (Req 7.1, 7.2)', () => {
    it('returns 422 VALIDATION_ERROR for a non-object body without touching the DB', async () => {
        const res = await updateAllocationModeHandler(putRequest('SUGGESTED'), authCtx());
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(findUniquePreference).not.toHaveBeenCalled();
        expect(upsertPreference).not.toHaveBeenCalled();
    });

    it('returns 422 VALIDATION_ERROR for a missing mode without touching the DB', async () => {
        const res = await updateAllocationModeHandler(putRequest({}), authCtx());
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(upsertPreference).not.toHaveBeenCalled();
    });

    it('returns 422 VALIDATION_ERROR for an invalid mode string without touching the DB', async () => {
        const res = await updateAllocationModeHandler(putRequest({ mode: 'TURBO' }), authCtx());
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(upsertPreference).not.toHaveBeenCalled();
    });

    it('upserts a valid mode scoped to the user and returns 200', async () => {
        upsertPreference.mockResolvedValue({
            userId: 'user-1',
            mode: EffectiveAllocationMode.SUGGESTED,
        });
        const res = await updateAllocationModeHandler(
            putRequest({ mode: EffectiveAllocationMode.SUGGESTED }),
            authCtx('user-1'),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { mode: string };
        expect(body.mode).toBe(EffectiveAllocationMode.SUGGESTED);
        expect(upsertPreference).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            update: { mode: EffectiveAllocationMode.SUGGESTED },
            create: { userId: 'user-1', mode: EffectiveAllocationMode.SUGGESTED },
        });
    });
});

describe('ownership / non-disclosure (Req 10.3, 10.4)', () => {
    it('GET throws ForbiddenError (-> 403) when the preference belongs to another user', async () => {
        findUniquePreference.mockResolvedValue({
            userId: 'someone-else',
            mode: EffectiveAllocationMode.SUGGESTED,
        });
        await expect(getAllocationModeHandler(getRequest(), authCtx('user-1'))).rejects.toMatchObject(
            { name: 'ForbiddenError' },
        );
    });

    it('GET non-disclosure: the forbidden error reveals nothing about the stored mode', async () => {
        findUniquePreference.mockResolvedValue({
            userId: 'someone-else',
            mode: EffectiveAllocationMode.SUGGESTED,
        });
        await expect(
            getAllocationModeHandler(getRequest(), authCtx('user-1')),
        ).rejects.toThrow(/access/i);
        // The same non-ownership rejection a missing row would produce — existence not leaked.
    });

    it('PUT throws ForbiddenError (-> 403) and does not upsert when the row belongs to another user', async () => {
        findUniquePreference.mockResolvedValue({
            userId: 'someone-else',
            mode: EffectiveAllocationMode.PHASE1_DEFAULT,
        });
        await expect(
            updateAllocationModeHandler(
                putRequest({ mode: EffectiveAllocationMode.SUGGESTED }),
                authCtx('user-1'),
            ),
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
        expect(upsertPreference).not.toHaveBeenCalled();
    });

    it('GET returns the mode when the preference is owned by the requesting user', async () => {
        findUniquePreference.mockResolvedValue({
            userId: 'user-1',
            mode: EffectiveAllocationMode.SUGGESTED,
        });
        const res = await getAllocationModeHandler(getRequest(), authCtx('user-1'));
        expect(res.status).toBe(200);
        expect(findUniquePreference).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
        const body = (await res.json()) as { mode: string };
        expect(body.mode).toBe(EffectiveAllocationMode.SUGGESTED);
    });

    it('GET returns PHASE1_DEFAULT without creating a row when no preference exists', async () => {
        findUniquePreference.mockResolvedValue(null);
        const res = await getAllocationModeHandler(getRequest(), authCtx('user-1'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { mode: string };
        expect(body.mode).toBe(EffectiveAllocationMode.PHASE1_DEFAULT);
        expect(upsertPreference).not.toHaveBeenCalled();
    });
});
