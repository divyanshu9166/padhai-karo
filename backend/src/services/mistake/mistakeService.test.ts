import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the Mistake Journal service handlers (task 14.1).
 *
 * The handlers are exercised against a mocked Prisma client so we never touch a live
 * database. We assert the behaviour the task specifies: upsert-not-duplicate with 201/200
 * (Req 18.4), missing/invalid category rejection (Req 18.2), rejecting a correctly-answered &
 * unflagged question and allowing incorrect/unanswered/explicit-flag (Req 18.3), server-side
 * resolution of correct/submitted answers and subject (Req 18.1), subject/category filtering
 * (Req 18.5/18.6) always user-scoped (Req 18.7), and per-user ownership on delete (404/403).
 *
 * The numbered property tests (Properties 35–37) belong to tasks 14.2–14.4; this task uses
 * example tests only.
 *
 * Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7
 */

// --- Prisma mock -------------------------------------------------------------
const {
    findUniquePyqAttempt,
    findUniqueTimedAttempt,
    findUniquePyq,
    upsertEntry,
    findManyEntry,
    findUniqueEntry,
    deleteEntry,
} = vi.hoisted(() => ({
    findUniquePyqAttempt: vi.fn(),
    findUniqueTimedAttempt: vi.fn(),
    findUniquePyq: vi.fn(),
    upsertEntry: vi.fn(),
    findManyEntry: vi.fn(),
    findUniqueEntry: vi.fn(),
    deleteEntry: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        pYQAttempt: { findUnique: findUniquePyqAttempt },
        timedPaperAttempt: { findUnique: findUniqueTimedAttempt },
        pYQ: { findUnique: findUniquePyq },
        mistakeJournalEntry: {
            upsert: upsertEntry,
            findMany: findManyEntry,
            findUnique: findUniqueEntry,
            delete: deleteEntry,
        },
    };
    return { default: prisma, prisma };
});

import {
    deleteMistakeHandler,
    flagMistakeHandler,
    listMistakesHandler,
} from './mistakeService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/mistakes', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

function getReq(query = ''): Request {
    return new Request(`http://localhost/api/mistakes${query}`);
}

/** A perQuestion JSON as written by the scoring function. */
const PER_QUESTION = [
    { questionId: 'q1', selectedOption: '0', correctOption: '0', outcome: 'CORRECT' },
    { questionId: 'q2', selectedOption: '3', correctOption: '1', outcome: 'INCORRECT' },
    { questionId: 'q3', selectedOption: null, correctOption: '2', outcome: 'UNANSWERED' },
];

const VALID_BODY = {
    sourceType: 'PYQ',
    attemptId: 'attempt-1',
    questionId: 'q2',
    category: 'CONCEPT_GAP',
    note: 'forgot the formula',
};

beforeEach(() => {
    findUniquePyqAttempt.mockReset();
    findUniqueTimedAttempt.mockReset();
    findUniquePyq.mockReset();
    upsertEntry.mockReset();
    findManyEntry.mockReset();
    findUniqueEntry.mockReset();
    deleteEntry.mockReset();
});

describe('flagMistakeHandler', () => {
    it('returns 422 when the JSON body is not an object', async () => {
        const res = await flagMistakeHandler(
            new Request('http://localhost/api/mistakes', { method: 'POST', body: 'oops' }),
            authCtx(),
        );
        expect(res.status).toBe(422);
        expect(findUniquePyqAttempt).not.toHaveBeenCalled();
    });

    it('returns 422 on a missing category without touching the DB (Req 18.2)', async () => {
        const res = await flagMistakeHandler(
            postReq({ sourceType: 'PYQ', attemptId: 'a', questionId: 'q2' }),
            authCtx(),
        );
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(findUniquePyqAttempt).not.toHaveBeenCalled();
    });

    it('returns 404 when the referenced attempt is missing or not owned', async () => {
        findUniquePyqAttempt.mockResolvedValue(null);
        const res = await flagMistakeHandler(postReq(VALID_BODY), authCtx('user-1'));
        expect(res.status).toBe(404);
        expect(upsertEntry).not.toHaveBeenCalled();
    });

    it("returns 404 for another user's attempt (no leak)", async () => {
        findUniquePyqAttempt.mockResolvedValue({
            userId: 'other',
            perQuestion: PER_QUESTION,
        });
        const res = await flagMistakeHandler(postReq(VALID_BODY), authCtx('user-1'));
        expect(res.status).toBe(404);
        expect(upsertEntry).not.toHaveBeenCalled();
    });

    it('rejects flagging a correctly-answered, unflagged question (Req 18.3)', async () => {
        findUniquePyqAttempt.mockResolvedValue({
            userId: 'user-1',
            perQuestion: PER_QUESTION,
        });
        const res = await flagMistakeHandler(
            postReq({ ...VALID_BODY, questionId: 'q1' }), // q1 is CORRECT
            authCtx('user-1'),
        );
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(upsertEntry).not.toHaveBeenCalled();
    });

    it('rejects a question not part of the attempt (Req 18.3)', async () => {
        findUniquePyqAttempt.mockResolvedValue({
            userId: 'user-1',
            perQuestion: PER_QUESTION,
        });
        const res = await flagMistakeHandler(
            postReq({ ...VALID_BODY, questionId: 'ghost' }),
            authCtx('user-1'),
        );
        expect(res.status).toBe(422);
        expect(upsertEntry).not.toHaveBeenCalled();
    });

    it('flags an incorrect question, resolving answers server-side, 201 on create (Req 18.1)', async () => {
        const now = new Date('2025-01-01T00:00:00.000Z');
        findUniquePyqAttempt.mockResolvedValue({
            userId: 'user-1',
            perQuestion: PER_QUESTION,
        });
        // correctAnswer + subjectId resolved from the stored question row, NOT the client.
        findUniquePyq.mockResolvedValue({ subjectId: 'sub-phys', correctOption: 1 });
        upsertEntry.mockResolvedValue({
            id: 'm1',
            userId: 'user-1',
            questionId: 'q2',
            subjectId: 'sub-phys',
            sourceType: 'PYQ',
            submittedAnswer: 3,
            correctAnswer: 1,
            category: 'CONCEPT_GAP',
            note: 'forgot the formula',
            createdAt: now,
            updatedAt: now, // created -> createdAt === updatedAt
        });

        const res = await flagMistakeHandler(postReq(VALID_BODY), authCtx('user-1'));
        expect(res.status).toBe(201);

        expect(findUniquePyq).toHaveBeenCalledWith({
            where: { id: 'q2' },
            select: { subjectId: true, correctOption: true },
        });

        // Upsert keyed on (userId, questionId) with server-resolved fields.
        expect(upsertEntry).toHaveBeenCalledTimes(1);
        const arg = upsertEntry.mock.calls[0][0];
        expect(arg.where).toEqual({ userId_questionId: { userId: 'user-1', questionId: 'q2' } });
        expect(arg.create).toMatchObject({
            userId: 'user-1',
            questionId: 'q2',
            subjectId: 'sub-phys',
            sourceType: 'PYQ',
            submittedAnswer: 3,
            correctAnswer: 1,
            category: 'CONCEPT_GAP',
            note: 'forgot the formula',
        });
        expect(arg.update).toMatchObject({
            subjectId: 'sub-phys',
            submittedAnswer: 3,
            correctAnswer: 1,
            category: 'CONCEPT_GAP',
        });

        const body = (await res.json()) as { entry: { id: string } };
        expect(body.entry.id).toBe('m1');
    });

    it('returns 200 when an existing entry is updated (upsert, Req 18.4)', async () => {
        findUniquePyqAttempt.mockResolvedValue({
            userId: 'user-1',
            perQuestion: PER_QUESTION,
        });
        findUniquePyq.mockResolvedValue({ subjectId: 'sub-phys', correctOption: 1 });
        upsertEntry.mockResolvedValue({
            id: 'm1',
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
            updatedAt: new Date('2025-02-01T00:00:00.000Z'), // updated -> later than created
        });

        const res = await flagMistakeHandler(postReq(VALID_BODY), authCtx('user-1'));
        expect(res.status).toBe(200);
    });

    it('allows flagging a CORRECT question when explicitly flagged (Req 18.3)', async () => {
        findUniquePyqAttempt.mockResolvedValue({
            userId: 'user-1',
            perQuestion: PER_QUESTION,
        });
        findUniquePyq.mockResolvedValue({ subjectId: 'sub-phys', correctOption: 0 });
        const now = new Date('2025-01-01T00:00:00.000Z');
        upsertEntry.mockResolvedValue({ id: 'm2', createdAt: now, updatedAt: now });

        const res = await flagMistakeHandler(
            postReq({ ...VALID_BODY, questionId: 'q1', explicitFlag: true }),
            authCtx('user-1'),
        );
        expect(res.status).toBe(201);
        // submittedAnswer for q1 is "0" -> 0
        const arg = upsertEntry.mock.calls[0][0];
        expect(arg.create.submittedAnswer).toBe(0);
    });

    it('records a null submittedAnswer for an unanswered question', async () => {
        findUniquePyqAttempt.mockResolvedValue({
            userId: 'user-1',
            perQuestion: PER_QUESTION,
        });
        findUniquePyq.mockResolvedValue({ subjectId: 'sub-bio', correctOption: 2 });
        const now = new Date('2025-01-01T00:00:00.000Z');
        upsertEntry.mockResolvedValue({ id: 'm3', createdAt: now, updatedAt: now });

        const res = await flagMistakeHandler(
            postReq({ ...VALID_BODY, questionId: 'q3' }), // UNANSWERED
            authCtx('user-1'),
        );
        expect(res.status).toBe(201);
        const arg = upsertEntry.mock.calls[0][0];
        expect(arg.create.submittedAnswer).toBeNull();
    });

    it('loads a TIMED attempt from the timed-paper table', async () => {
        findUniqueTimedAttempt.mockResolvedValue({
            userId: 'user-1',
            perQuestion: PER_QUESTION,
        });
        findUniquePyq.mockResolvedValue({ subjectId: 'sub-chem', correctOption: 1 });
        const now = new Date('2025-01-01T00:00:00.000Z');
        upsertEntry.mockResolvedValue({ id: 'm4', createdAt: now, updatedAt: now });

        const res = await flagMistakeHandler(
            postReq({ ...VALID_BODY, sourceType: 'TIMED' }),
            authCtx('user-1'),
        );
        expect(res.status).toBe(201);
        expect(findUniqueTimedAttempt).toHaveBeenCalled();
        expect(findUniquePyqAttempt).not.toHaveBeenCalled();
    });

    it('returns 404 when the question row is missing', async () => {
        findUniquePyqAttempt.mockResolvedValue({
            userId: 'user-1',
            perQuestion: PER_QUESTION,
        });
        findUniquePyq.mockResolvedValue(null);
        const res = await flagMistakeHandler(postReq(VALID_BODY), authCtx('user-1'));
        expect(res.status).toBe(404);
        expect(upsertEntry).not.toHaveBeenCalled();
    });
});

describe('listMistakesHandler', () => {
    it('lists all of the user\'s entries with no filters (Req 18.7)', async () => {
        findManyEntry.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
        const res = await listMistakesHandler(getReq(), authCtx('user-42'));
        expect(res.status).toBe(200);
        expect(findManyEntry).toHaveBeenCalledWith({
            where: { userId: 'user-42' },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        });
        const body = (await res.json()) as { entries: unknown[] };
        expect(body.entries).toHaveLength(2);
    });

    it('filters by subject and category when provided (Req 18.5/18.6)', async () => {
        findManyEntry.mockResolvedValue([]);
        const res = await listMistakesHandler(
            getReq('?subjectId=sub-1&category=TIME_PRESSURE'),
            authCtx('user-1'),
        );
        expect(res.status).toBe(200);
        expect(findManyEntry).toHaveBeenCalledWith({
            where: { userId: 'user-1', subjectId: 'sub-1', category: 'TIME_PRESSURE' },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        });
    });

    it('returns 422 for an invalid category filter', async () => {
        const res = await listMistakesHandler(getReq('?category=bogus'), authCtx());
        expect(res.status).toBe(422);
        expect(findManyEntry).not.toHaveBeenCalled();
    });
});

describe('deleteMistakeHandler', () => {
    const routeCtx = (id: string) => ({ params: { id } });

    it('deletes an owned entry and returns 204', async () => {
        findUniqueEntry.mockResolvedValue({ id: 'm1', userId: 'user-1' });
        deleteEntry.mockResolvedValue({ id: 'm1' });
        const res = await deleteMistakeHandler(
            new Request('http://localhost/api/mistakes/m1', { method: 'DELETE' }),
            authCtx('user-1'),
            routeCtx('m1'),
        );
        expect(res.status).toBe(204);
        expect(deleteEntry).toHaveBeenCalledWith({ where: { id: 'm1' } });
    });

    it('returns 404 for a missing entry', async () => {
        findUniqueEntry.mockResolvedValue(null);
        const res = await deleteMistakeHandler(
            new Request('http://localhost/api/mistakes/missing', { method: 'DELETE' }),
            authCtx('user-1'),
            routeCtx('missing'),
        );
        expect(res.status).toBe(404);
        expect(deleteEntry).not.toHaveBeenCalled();
    });

    it("throws ForbiddenError for another user's entry (mapped to 403 by withAuth)", async () => {
        findUniqueEntry.mockResolvedValue({ id: 'm1', userId: 'other' });
        await expect(
            deleteMistakeHandler(
                new Request('http://localhost/api/mistakes/m1', { method: 'DELETE' }),
                authCtx('user-1'),
                routeCtx('m1'),
            ),
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
        expect(deleteEntry).not.toHaveBeenCalled();
    });
});
