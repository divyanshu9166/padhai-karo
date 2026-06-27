import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the PYQ attempt submission/persistence service
 * (task 11.3).
 *
 * The pure answer-key assembly and scoring orchestration ({@link buildAnswerKey},
 * {@link scorePyqAttempt}) are exercised directly. The handlers are exercised against a
 * mocked Prisma client so we never touch a live database — we assert the behaviour the
 * task specifies: server-side answer-key resolution + correct scoring (incl. unanswered),
 * persistence scoped to the user, the 409 clientId-duplicate path, and per-user ownership
 * on read (404 for another user's attempt).
 *
 * The numbered scoring property test (Property 31) is task 11.4 and is intentionally not
 * implemented here.
 *
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5
 */

// --- Prisma mock -------------------------------------------------------------
const { findManyPyq, createAttempt, findUniqueAttempt } = vi.hoisted(() => ({
    findManyPyq: vi.fn(),
    createAttempt: vi.fn(),
    findUniqueAttempt: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        pYQ: { findMany: findManyPyq },
        pYQAttempt: { create: createAttempt, findUnique: findUniqueAttempt },
    };
    return { default: prisma, prisma };
});

import {
    buildAnswerKey,
    createPyqAttemptHandler,
    getPyqAttemptHandler,
    scorePyqAttempt,
} from './pyqAttemptService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/pyq-attempts', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    findManyPyq.mockReset();
    createAttempt.mockReset();
    findUniqueAttempt.mockReset();
});

describe('buildAnswerKey', () => {
    it('maps questionId -> stringified correctOption', () => {
        expect(
            buildAnswerKey([
                { id: 'q1', correctOption: 2 },
                { id: 'q2', correctOption: 0 },
            ]),
        ).toEqual([
            { questionId: 'q1', correctOption: '2' },
            { questionId: 'q2', correctOption: '0' },
        ]);
    });
});

describe('scorePyqAttempt', () => {
    const questions = [
        { id: 'q1', correctOption: 0 },
        { id: 'q2', correctOption: 1 },
        { id: 'q3', correctOption: 2 },
    ];

    it('scores correct, incorrect, and unanswered against the server key', () => {
        const result = scorePyqAttempt(
            [
                { questionId: 'q1', selectedOption: 0 }, // correct
                { questionId: 'q2', selectedOption: 3 }, // incorrect
                { questionId: 'q3', selectedOption: null }, // unanswered
            ],
            questions,
        );

        expect(result.totalScore).toBe(1);
        expect(result.perQuestion).toEqual([
            { questionId: 'q1', selectedOption: '0', correctOption: '0', outcome: 'CORRECT' },
            { questionId: 'q2', selectedOption: '3', correctOption: '1', outcome: 'INCORRECT' },
            {
                questionId: 'q3',
                selectedOption: null,
                correctOption: '2',
                outcome: 'UNANSWERED',
            },
        ]);
    });

    it('scores a question with no submitted answer as UNANSWERED (key drives the set)', () => {
        const result = scorePyqAttempt([{ questionId: 'q1', selectedOption: 0 }], questions);
        expect(result.totalScore).toBe(1);
        // All three questions appear; q2/q3 are UNANSWERED.
        expect(result.perQuestion.map((p) => p.outcome)).toEqual([
            'CORRECT',
            'UNANSWERED',
            'UNANSWERED',
        ]);
    });

    it('ignores submitted answers for questions absent from the loaded key', () => {
        const result = scorePyqAttempt(
            [
                { questionId: 'q1', selectedOption: 0 },
                { questionId: 'ghost', selectedOption: 0 },
            ],
            [{ id: 'q1', correctOption: 0 }],
        );
        expect(result.perQuestion).toHaveLength(1);
        expect(result.totalScore).toBe(1);
    });
});

describe('createPyqAttemptHandler', () => {
    it('returns 422 on an invalid body without touching the DB', async () => {
        const res = await createPyqAttemptHandler(postReq({ answers: [] }), authCtx());
        expect(res.status).toBe(422);
        expect(findManyPyq).not.toHaveBeenCalled();
        expect(createAttempt).not.toHaveBeenCalled();
    });

    it('returns 422 when the JSON body is not an object', async () => {
        const res = await createPyqAttemptHandler(
            new Request('http://localhost/api/pyq-attempts', { method: 'POST', body: 'oops' }),
            authCtx(),
        );
        expect(res.status).toBe(422);
        expect(createAttempt).not.toHaveBeenCalled();
    });

    it('resolves the key server-side, scores, persists scoped to the user, returns 201', async () => {
        // Server-side correctOption resolved from the DB rows, NOT from the client.
        findManyPyq.mockResolvedValue([
            { id: 'q1', correctOption: 0 },
            { id: 'q2', correctOption: 1 },
        ]);
        createAttempt.mockResolvedValue({ id: 'attempt-9' });

        const res = await createPyqAttemptHandler(
            postReq({
                paperOrSetRef: 'jee-2024',
                answers: [
                    { questionId: 'q1', selectedOption: 0 }, // correct
                    { questionId: 'q2', selectedOption: 2 }, // incorrect
                ],
                clientId: 'c-1',
            }),
            authCtx('user-42'),
        );

        expect(res.status).toBe(201);

        // Only the safe columns are read for the key.
        expect(findManyPyq).toHaveBeenCalledWith({
            where: { id: { in: ['q1', 'q2'] } },
            select: { id: true, correctOption: true },
        });

        // Persisted scoped to the authenticated user with computed score.
        expect(createAttempt).toHaveBeenCalledTimes(1);
        const createArg = createAttempt.mock.calls[0][0];
        expect(createArg.data.userId).toBe('user-42');
        expect(createArg.data.paperOrSetRef).toBe('jee-2024');
        expect(createArg.data.totalScore).toBe(1);
        expect(createArg.data.clientId).toBe('c-1');

        const body = (await res.json()) as {
            attemptId: string;
            totalScore: number;
            perQuestion: Array<{ outcome: string }>;
        };
        expect(body.attemptId).toBe('attempt-9');
        expect(body.totalScore).toBe(1);
        expect(body.perQuestion.map((p) => p.outcome)).toEqual(['CORRECT', 'INCORRECT']);
    });

    it('does not trust a client-supplied correct answer', async () => {
        findManyPyq.mockResolvedValue([{ id: 'q1', correctOption: 0 }]);
        createAttempt.mockResolvedValue({ id: 'a-1' });

        // Client tries to sneak a correctOption/outcome; it must be ignored.
        const res = await createPyqAttemptHandler(
            postReq({
                paperOrSetRef: 'ref',
                answers: [
                    { questionId: 'q1', selectedOption: 3, correctOption: 3, outcome: 'CORRECT' },
                ],
            }),
            authCtx(),
        );

        expect(res.status).toBe(201);
        const body = (await res.json()) as { totalScore: number };
        // selectedOption 3 != server key 0 => incorrect, score 0.
        expect(body.totalScore).toBe(0);
    });

    it('maps a duplicate clientId (P2002) to 409 CONFLICT', async () => {
        findManyPyq.mockResolvedValue([{ id: 'q1', correctOption: 0 }]);
        createAttempt.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('dup', {
                code: 'P2002',
                clientVersion: 'test',
            }),
        );

        const res = await createPyqAttemptHandler(
            postReq({
                paperOrSetRef: 'ref',
                answers: [{ questionId: 'q1', selectedOption: 0 }],
                clientId: 'dup',
            }),
            authCtx(),
        );

        expect(res.status).toBe(409);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('CONFLICT');
    });
});

describe('getPyqAttemptHandler', () => {
    const routeCtx = (id: string) => ({ params: { id } });

    it('returns the attempt to its owner', async () => {
        findUniqueAttempt.mockResolvedValue({ id: 'a-1', userId: 'user-1', totalScore: 3 });
        const res = await getPyqAttemptHandler(
            new Request('http://localhost/api/pyq-attempts/a-1'),
            authCtx('user-1'),
            routeCtx('a-1'),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { attempt: { id: string } };
        expect(body.attempt.id).toBe('a-1');
    });

    it('returns 404 for a missing attempt', async () => {
        findUniqueAttempt.mockResolvedValue(null);
        const res = await getPyqAttemptHandler(
            new Request('http://localhost/api/pyq-attempts/missing'),
            authCtx('user-1'),
            routeCtx('missing'),
        );
        expect(res.status).toBe(404);
    });

    it("returns 404 (not 403) for another user's attempt, without leaking existence", async () => {
        findUniqueAttempt.mockResolvedValue({ id: 'a-1', userId: 'other-user' });
        const res = await getPyqAttemptHandler(
            new Request('http://localhost/api/pyq-attempts/a-1'),
            authCtx('user-1'),
            routeCtx('a-1'),
        );
        expect(res.status).toBe(404);
    });
});
