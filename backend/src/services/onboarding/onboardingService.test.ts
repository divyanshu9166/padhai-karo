import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit test for Req 2.5: a subject/chapter-association failure must preserve the
 * exam-track selection and let onboarding continue (task 4.5).
 *
 * The onboarding handler persists the profile + track FIRST (its own write) and then
 * attempts chapter association in a try/catch. Here Prisma is mocked so chapter creation
 * throws; we assert the profile/track is still persisted and the response succeeds with
 * `chaptersAssociated: false` (HTTP 200).
 *
 * Validates: Requirements 2.5
 */

// `vi.mock` is hoisted above the module body, so the mock fns must be created via
// `vi.hoisted` to be available inside the (also hoisted) factory.
const {
    profileUpsert,
    fixedCommitmentDeleteMany,
    fixedCommitmentCreateMany,
    chapterDeleteMany,
    chapterCreateMany,
    transaction,
} = vi.hoisted(() => ({
    profileUpsert: vi.fn(),
    fixedCommitmentDeleteMany: vi.fn(),
    fixedCommitmentCreateMany: vi.fn(),
    chapterDeleteMany: vi.fn(),
    chapterCreateMany: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { upsert: profileUpsert },
        fixedCommitment: { deleteMany: fixedCommitmentDeleteMany, createMany: fixedCommitmentCreateMany },
        chapter: { deleteMany: chapterDeleteMany, createMany: chapterCreateMany },
        // The service calls `$transaction([...])` with an array of operations. Await them
        // all so a rejected operation (chapter creation) rejects the transaction.
        $transaction: transaction,
    };
    return { default: prisma, prisma };
});

import { onboardingHandler } from './onboardingService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function postRequest(body: unknown): Request {
    return new Request('http://localhost/api/onboarding', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

const VALID_PAYLOAD = {
    examTrack: 'JEE',
    targetYear: new Date().getUTCFullYear() + 1,
    currentClass: 'Class 12',
    fixedCommitments: [{ dayOfWeek: 1, startTime: '08:00', endTime: '14:00', label: 'School' }],
    peakFocusWindows: ['MORNING'],
};

describe('onboardingHandler — subject-association failure preserves track (Req 2.5)', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // The profile/track write succeeds and is durable.
        profileUpsert.mockResolvedValue({
            userId: 'user-1',
            examTrack: 'JEE',
            targetYear: VALID_PAYLOAD.targetYear,
            onboardingComplete: true,
        });

        // Fixed-commitment ops succeed.
        fixedCommitmentDeleteMany.mockResolvedValue({ count: 0 });
        fixedCommitmentCreateMany.mockResolvedValue({ count: 1 });

        // Chapter association FAILS: chapter creation throws.
        chapterDeleteMany.mockResolvedValue({ count: 0 });
        chapterCreateMany.mockRejectedValue(new Error('chapter association failed'));

        // `$transaction([...])` resolves all supplied operations; a rejected op rejects it.
        transaction.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops));
    });

    it('persists the profile/track and returns 200 with chaptersAssociated:false', async () => {
        const response = await onboardingHandler(postRequest(VALID_PAYLOAD), authCtx());

        // Onboarding continues despite the association failure.
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            profile: { examTrack: string; onboardingComplete: boolean };
            chaptersAssociated: boolean;
        };
        expect(body.chaptersAssociated).toBe(false);

        // The exam-track selection is preserved (profile was persisted first).
        expect(profileUpsert).toHaveBeenCalledTimes(1);
        const upsertArgs = profileUpsert.mock.calls[0][0] as {
            where: { userId: string };
            create: { examTrack: string; onboardingComplete: boolean };
            update: { examTrack: string; onboardingComplete: boolean };
        };
        expect(upsertArgs.where.userId).toBe('user-1');
        expect(upsertArgs.create.examTrack).toBe('JEE');
        expect(upsertArgs.update.examTrack).toBe('JEE');
        expect(upsertArgs.create.onboardingComplete).toBe(true);

        // The persisted profile in the response carries the selected track.
        expect(body.profile.examTrack).toBe('JEE');
        expect(body.profile.onboardingComplete).toBe(true);

        // Association was genuinely attempted (and failed).
        expect(chapterCreateMany).toHaveBeenCalled();
    });
});
