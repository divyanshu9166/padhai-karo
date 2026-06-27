import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DB-independent handler tests for the Profile Service (task 4.2). The handlers are
 * exercised against a mocked Prisma client so we never touch a live database — we only
 * assert the behaviour the task specifies: per-user scoping, validation (422), the
 * end>start boundary on fixed commitments (Req 2.3), language/peak-window persistence
 * (Req 10.1 / 2.8), and per-user ownership on delete (404/403).
 *
 * Validates: Requirements 2.1, 2.3, 2.8, 10.1
 */

const {
    findUniqueProfile,
    updateProfile,
    createCommitment,
    findUniqueCommitment,
    deleteCommitment,
} = vi.hoisted(() => ({
    findUniqueProfile: vi.fn(),
    updateProfile: vi.fn(),
    createCommitment: vi.fn(),
    findUniqueCommitment: vi.fn(),
    deleteCommitment: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: findUniqueProfile, update: updateProfile },
        fixedCommitment: {
            create: createCommitment,
            findUnique: findUniqueCommitment,
            delete: deleteCommitment,
        },
    };
    return { default: prisma, prisma };
});

import {
    createFixedCommitmentHandler,
    deleteFixedCommitmentHandler,
    getProfileHandler,
    updateLanguageHandler,
    updatePeakWindowsHandler,
} from './profileService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function jsonRequest(body: unknown): Request {
    return new Request('http://localhost/api/profile', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function notFoundError(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
        code: 'P2025',
        clientVersion: 'test',
    });
}

beforeEach(() => {
    findUniqueProfile.mockReset();
    updateProfile.mockReset();
    createCommitment.mockReset();
    findUniqueCommitment.mockReset();
    deleteCommitment.mockReset();
});

describe('getProfileHandler', () => {
    it('returns 200 with the profile scoped to the authenticated user', async () => {
        findUniqueProfile.mockResolvedValue({ userId: 'user-7', language: 'EN' });
        const res = await getProfileHandler(jsonRequest({}), authCtx('user-7'));
        expect(res.status).toBe(200);
        expect(findUniqueProfile).toHaveBeenCalledWith({ where: { userId: 'user-7' } });
        const body = (await res.json()) as { profile: { userId: string } };
        expect(body.profile.userId).toBe('user-7');
    });

    it('returns 404 when the user has no profile', async () => {
        findUniqueProfile.mockResolvedValue(null);
        const res = await getProfileHandler(jsonRequest({}), authCtx());
        expect(res.status).toBe(404);
        expect(updateProfile).not.toHaveBeenCalled();
    });
});

describe('updateLanguageHandler (Req 10.1)', () => {
    it('persists a supported language scoped to the user', async () => {
        updateProfile.mockResolvedValue({ userId: 'user-1', language: 'HI' });
        const res = await updateLanguageHandler(jsonRequest({ language: 'HI' }), authCtx('user-1'));
        expect(res.status).toBe(200);
        expect(updateProfile).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            data: { language: 'HI' },
        });
    });

    it('returns 422 for an unsupported language without touching the DB', async () => {
        const res = await updateLanguageHandler(jsonRequest({ language: 'FR' }), authCtx());
        expect(res.status).toBe(422);
        expect(updateProfile).not.toHaveBeenCalled();
    });

    it('returns 404 when the profile does not exist (P2025)', async () => {
        updateProfile.mockRejectedValue(notFoundError());
        const res = await updateLanguageHandler(jsonRequest({ language: 'EN' }), authCtx());
        expect(res.status).toBe(404);
    });
});

describe('updatePeakWindowsHandler (Req 2.8)', () => {
    it('persists a de-duplicated window set scoped to the user', async () => {
        updateProfile.mockResolvedValue({ userId: 'user-1', peakFocusWindows: ['MORNING', 'NIGHT'] });
        const res = await updatePeakWindowsHandler(
            jsonRequest({ windows: ['MORNING', 'NIGHT', 'MORNING'] }),
            authCtx('user-1'),
        );
        expect(res.status).toBe(200);
        expect(updateProfile).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            data: { peakFocusWindows: ['MORNING', 'NIGHT'] },
        });
    });

    it('returns 422 for an unknown window without touching the DB', async () => {
        const res = await updatePeakWindowsHandler(jsonRequest({ windows: ['EVENING'] }), authCtx());
        expect(res.status).toBe(422);
        expect(updateProfile).not.toHaveBeenCalled();
    });

    it('returns 404 when the profile does not exist (P2025)', async () => {
        updateProfile.mockRejectedValue(notFoundError());
        const res = await updatePeakWindowsHandler(jsonRequest({ windows: [] }), authCtx());
        expect(res.status).toBe(404);
    });
});

describe('createFixedCommitmentHandler (Req 2.1, 2.3)', () => {
    it('creates a valid commitment scoped to the user and returns 201', async () => {
        createCommitment.mockResolvedValue({ id: 'fc-1', userId: 'user-1' });
        const res = await createFixedCommitmentHandler(
            jsonRequest({ dayOfWeek: 1, startTime: '08:00', endTime: '14:00', label: 'School' }),
            authCtx('user-1'),
        );
        expect(res.status).toBe(201);
        expect(createCommitment).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                dayOfWeek: 1,
                startTime: '08:00',
                endTime: '14:00',
                label: 'School',
            },
        });
    });

    it('returns 422 when end <= start without touching the DB (Req 2.3)', async () => {
        const res = await createFixedCommitmentHandler(
            jsonRequest({ dayOfWeek: 1, startTime: '14:00', endTime: '08:00', label: 'School' }),
            authCtx(),
        );
        expect(res.status).toBe(422);
        expect(createCommitment).not.toHaveBeenCalled();
    });
});

describe('deleteFixedCommitmentHandler (ownership)', () => {
    const ctx = { params: { id: 'fc-1' } };

    it('returns 204 and deletes a commitment owned by the user', async () => {
        findUniqueCommitment.mockResolvedValue({ id: 'fc-1', userId: 'user-1' });
        deleteCommitment.mockResolvedValue({ id: 'fc-1' });
        const res = await deleteFixedCommitmentHandler(jsonRequest({}), authCtx('user-1'), ctx);
        expect(res.status).toBe(204);
        expect(deleteCommitment).toHaveBeenCalledWith({ where: { id: 'fc-1' } });
    });

    it('returns 404 when the commitment does not exist', async () => {
        findUniqueCommitment.mockResolvedValue(null);
        const res = await deleteFixedCommitmentHandler(jsonRequest({}), authCtx('user-1'), ctx);
        expect(res.status).toBe(404);
        expect(deleteCommitment).not.toHaveBeenCalled();
    });

    it('throws ForbiddenError (-> 403) when the commitment belongs to another user', async () => {
        findUniqueCommitment.mockResolvedValue({ id: 'fc-1', userId: 'someone-else' });
        await expect(
            deleteFixedCommitmentHandler(jsonRequest({}), authCtx('user-1'), ctx),
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
        expect(deleteCommitment).not.toHaveBeenCalled();
    });
});
