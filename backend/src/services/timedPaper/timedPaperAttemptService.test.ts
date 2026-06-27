import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the Timed Paper Mode service (task 13.1).
 *
 * The pure answer-key assembly and scoring orchestration ({@link buildAnswerKey},
 * {@link scoreTimedAttempt}) are exercised directly — including the timed-mode invariant
 * that EVERY question of the paper is scored, so a question never reached (absent from the
 * submitted answers) is `UNANSWERED` and counted incorrect. The handlers run against a
 * mocked Prisma client so we never touch a live database, asserting: server-side answer-key
 * resolution from the paper rows, correct scoring, the no-answer-key paper listing
 * (404/omitted correctOption), persistence scoped to the user, the 409 clientId-duplicate
 * path, and per-user ownership on read.
 *
 * The numbered journal-eligibility property test (Property 38) is task 13.2 and is
 * intentionally not implemented here.
 *
 * Validates: Requirements 19.5, 19.6, 19.7, 19.8
 */

// --- Prisma mock -------------------------------------------------------------
const { findUniquePaper, findManyPyq, createAttempt, findUniqueAttempt } = vi.hoisted(() => ({
    findUniquePaper: vi.fn(),
    findManyPyq: vi.fn(),
    createAttempt: vi.fn(),
    findUniqueAttempt: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        pYQPaper: { findUnique: findUniquePaper },
        pYQ: { findMany: findManyPyq },
        timedPaperAttempt: { create: createAttempt, findUnique: findUniqueAttempt },
    };
    return { default: prisma, prisma };
});

import {
    buildAnswerKey,
    createTimedAttemptHandler,
    getPaperHandler,
    getTimedAttemptHandler,
    scoreTimedAttempt,
} from './timedPaperAttemptService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/timed-attempts', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    findUniquePaper.mockReset();
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

describe('scoreTimedAttempt', () => {
    const paperQuestions = [
        { id: 'q1', correctOption: 0 },
        { id: 'q2', correctOption: 1 },
        { id: 'q3', correctOption: 2 },
        { id: 'q4', correctOption: 3 },
    ];

    it('scores correct, incorrect, explicit-unanswered, and never-reached questions', () => {
        const result = scoreTimedAttempt(
            [
                { questionId: 'q1', selectedOption: 0 }, // correct
                { questionId: 'q2', selectedOption: 3 }, // incorrect
                { questionId: 'q3', selectedOption: null }, // explicitly unanswered
                // q4 never reached -> absent from answers entirely
            ],
            paperQuestions,
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
            {
                questionId: 'q4',
                selectedOption: null,
                correctOption: '3',
                outcome: 'UNANSWERED',
            },
        ]);
    });

    it('scores EVERY question of the paper even when no answers are submitted', () => {
        const result = scoreTimedAttempt([], paperQuestions);
        expect(result.totalScore).toBe(0);
        expect(result.perQuestion).toHaveLength(4);
        expect(result.perQuestion.every((p) => p.outcome === 'UNANSWERED')).toBe(true);
    });

    it('ignores submitted answers for questions not in the paper', () => {
        const result = scoreTimedAttempt(
            [
                { questionId: 'q1', selectedOption: 0 },
                { questionId: 'ghost', selectedOption: 0 },
            ],
            [{ id: 'q1', correctOption: 0 }],
        );
        expect(result.perQuestion).toHaveLength(1);
        expect(result.totalScore).toBe(1);
    });

    it('exposes incorrect questions for journal eligibility via outcome + questionId (Req 19.8)', () => {
        const result = scoreTimedAttempt(
            [{ questionId: 'q2', selectedOption: 3 }],
            [
                { id: 'q1', correctOption: 0 },
                { id: 'q2', correctOption: 1 },
            ],
        );
        const incorrect = result.perQuestion.filter((p) => p.outcome === 'INCORRECT');
        expect(incorrect).toEqual([
            { questionId: 'q2', selectedOption: '3', correctOption: '1', outcome: 'INCORRECT' },
        ]);
    });
});

describe('getPaperHandler', () => {
    const routeCtx = (id: string) => ({ params: { id } });

    it('returns the duration and questions without the answer key', async () => {
        findUniquePaper.mockResolvedValue({
            id: 'paper-1',
            examTrack: 'JEE',
            year: 2024,
            session: 'Shift 1',
            durationMin: 180,
        });
        findManyPyq.mockResolvedValue([
            { id: 'q1', questionText: 'Q1?', options: ['a', 'b', 'c', 'd'] },
            { id: 'q2', questionText: 'Q2?', options: ['a', 'b', 'c', 'd'] },
        ]);

        const res = await getPaperHandler(
            new Request('http://localhost/api/papers/paper-1'),
            authCtx(),
            routeCtx('paper-1'),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            paper: Record<string, unknown>;
            durationMin: number;
            questions: Array<Record<string, unknown>>;
        };
        expect(body.durationMin).toBe(180);
        expect(body.paper).toEqual({
            id: 'paper-1',
            examTrack: 'JEE',
            year: 2024,
            session: 'Shift 1',
        });
        expect(body.questions).toHaveLength(2);
        // No correctOption leaked.
        expect(body.questions.every((q) => !('correctOption' in q))).toBe(true);

        // Only practice-eligible (non-flagged) questions are listed.
        expect(findManyPyq).toHaveBeenCalledWith({
            where: { paperId: 'paper-1', flaggedForReview: false },
            select: { id: true, questionText: true, options: true },
            orderBy: { id: 'asc' },
        });
    });

    it('returns 404 for a missing paper', async () => {
        findUniquePaper.mockResolvedValue(null);
        const res = await getPaperHandler(
            new Request('http://localhost/api/papers/missing'),
            authCtx(),
            routeCtx('missing'),
        );
        expect(res.status).toBe(404);
        expect(findManyPyq).not.toHaveBeenCalled();
    });
});

describe('createTimedAttemptHandler', () => {
    it('returns 422 on an invalid body without touching the DB', async () => {
        const res = await createTimedAttemptHandler(postReq({ answers: [] }), authCtx());
        expect(res.status).toBe(422);
        expect(findManyPyq).not.toHaveBeenCalled();
        expect(createAttempt).not.toHaveBeenCalled();
    });

    it('returns 422 when the JSON body is not an object', async () => {
        const res = await createTimedAttemptHandler(
            new Request('http://localhost/api/timed-attempts', { method: 'POST', body: 'oops' }),
            authCtx(),
        );
        expect(res.status).toBe(422);
        expect(createAttempt).not.toHaveBeenCalled();
    });

    it('returns 404 when the paper has no practice-eligible questions', async () => {
        findManyPyq.mockResolvedValue([]);
        const res = await createTimedAttemptHandler(
            postReq({ paperId: 'empty', answers: [], timeTakenSec: 10 }),
            authCtx(),
        );
        expect(res.status).toBe(404);
        expect(createAttempt).not.toHaveBeenCalled();
    });

    it('resolves the key server-side, scores every question, persists scoped to the user, returns 201', async () => {
        // Server-side correctOption resolved from the paper rows, NOT from the client.
        findManyPyq.mockResolvedValue([
            { id: 'q1', correctOption: 0 },
            { id: 'q2', correctOption: 1 },
            { id: 'q3', correctOption: 2 }, // never reached
        ]);
        createAttempt.mockResolvedValue({ id: 'attempt-9' });

        const res = await createTimedAttemptHandler(
            postReq({
                paperId: 'paper-1',
                answers: [
                    { questionId: 'q1', selectedOption: 0 }, // correct
                    { questionId: 'q2', selectedOption: 2 }, // incorrect
                ],
                timeTakenSec: 3540,
                clientId: 'c-1',
            }),
            authCtx('user-42'),
        );

        expect(res.status).toBe(201);

        expect(findManyPyq).toHaveBeenCalledWith({
            where: { paperId: 'paper-1', flaggedForReview: false },
            select: { id: true, correctOption: true },
            orderBy: { id: 'asc' },
        });

        // Persisted scoped to the authenticated user with computed score and time taken.
        expect(createAttempt).toHaveBeenCalledTimes(1);
        const createArg = createAttempt.mock.calls[0][0];
        expect(createArg.data.userId).toBe('user-42');
        expect(createArg.data.paperId).toBe('paper-1');
        expect(createArg.data.totalScore).toBe(1);
        expect(createArg.data.timeTakenSec).toBe(3540);
        expect(createArg.data.clientId).toBe('c-1');

        const body = (await res.json()) as {
            attemptId: string;
            totalScore: number;
            perQuestion: Array<{ questionId: string; outcome: string }>;
        };
        expect(body.attemptId).toBe('attempt-9');
        expect(body.totalScore).toBe(1);
        // q3 was never reached -> scored UNANSWERED (counted incorrect).
        expect(body.perQuestion.map((p) => [p.questionId, p.outcome])).toEqual([
            ['q1', 'CORRECT'],
            ['q2', 'INCORRECT'],
            ['q3', 'UNANSWERED'],
        ]);
    });

    it('does not trust a client-supplied correct answer', async () => {
        findManyPyq.mockResolvedValue([{ id: 'q1', correctOption: 0 }]);
        createAttempt.mockResolvedValue({ id: 'a-1' });

        const res = await createTimedAttemptHandler(
            postReq({
                paperId: 'paper-1',
                answers: [
                    { questionId: 'q1', selectedOption: 3, correctOption: 3, outcome: 'CORRECT' },
                ],
                timeTakenSec: 100,
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

        const res = await createTimedAttemptHandler(
            postReq({
                paperId: 'paper-1',
                answers: [{ questionId: 'q1', selectedOption: 0 }],
                timeTakenSec: 100,
                clientId: 'dup',
            }),
            authCtx(),
        );

        expect(res.status).toBe(409);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('CONFLICT');
    });
});

describe('getTimedAttemptHandler', () => {
    const routeCtx = (id: string) => ({ params: { id } });

    it('returns the attempt to its owner', async () => {
        findUniqueAttempt.mockResolvedValue({ id: 'a-1', userId: 'user-1', totalScore: 3 });
        const res = await getTimedAttemptHandler(
            new Request('http://localhost/api/timed-attempts/a-1'),
            authCtx('user-1'),
            routeCtx('a-1'),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { attempt: { id: string } };
        expect(body.attempt.id).toBe('a-1');
    });

    it('returns 404 for a missing attempt', async () => {
        findUniqueAttempt.mockResolvedValue(null);
        const res = await getTimedAttemptHandler(
            new Request('http://localhost/api/timed-attempts/missing'),
            authCtx('user-1'),
            routeCtx('missing'),
        );
        expect(res.status).toBe(404);
    });

    it("returns 404 (not 403) for another user's attempt, without leaking existence", async () => {
        findUniqueAttempt.mockResolvedValue({ id: 'a-1', userId: 'other-user' });
        const res = await getTimedAttemptHandler(
            new Request('http://localhost/api/timed-attempts/a-1'),
            authCtx('user-1'),
            routeCtx('a-1'),
        );
        expect(res.status).toBe(404);
    });
});
