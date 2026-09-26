import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    profileFind: vi.fn(),
    pyqFindMany: vi.fn(),
    attemptFindUnique: vi.fn(),
    attemptFindMany: vi.fn(),
    attemptCreate: vi.fn(),
    cardCreateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: mocks.profileFind },
        pYQ: { findMany: mocks.pyqFindMany },
        dailyQuizAttempt: { findUnique: mocks.attemptFindUnique, findMany: mocks.attemptFindMany, create: mocks.attemptCreate },
        revisionCard: { createMany: mocks.cardCreateMany },
        $transaction: (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma)),
    };
    return { prisma, default: prisma };
});

import type { AuthContext } from '@/lib/auth';

import {
    computeQuizStreak,
    getDailyQuizHandler,
    indiaDateKey,
    pickDailyQuestions,
    seededOrder,
    submitDailyQuizHandler,
} from './dailyQuizService';

const auth = { user: { id: 'u1' } } as AuthContext;
// 23:00 UTC on the 24th is 04:30 IST on the 25th.
const NOW = new Date('2026-09-24T23:00:00.000Z');

const bank = Array.from({ length: 30 }, (_, i) => ({
    id: `q${String(i).padStart(2, '0')}`,
    questionText: `Question ${i}`,
    options: ['A', 'B', 'C', 'D'],
    correctOption: i % 4,
    year: 2020 + (i % 5),
    subjectId: 'UPSC-CSE-GS1',
}));

function wirePool(pool = bank): void {
    mocks.pyqFindMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] } } }) =>
        where.id ? pool.filter((row) => where.id!.in.includes(row.id)) : pool);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileFind.mockResolvedValue({ examTrack: 'UPSC', examProgram: 'UPSC_CSE', examStage: 'PRELIMS' });
    mocks.attemptFindUnique.mockResolvedValue(null);
    mocks.attemptFindMany.mockResolvedValue([]);
    mocks.attemptCreate.mockResolvedValue({ id: 'a1' });
    mocks.cardCreateMany.mockResolvedValue({ count: 0 });
    wirePool();
});

describe('pure helpers', () => {
    it('uses the India calendar day, not UTC', () => {
        expect(indiaDateKey(new Date('2026-09-24T18:29:59.000Z'))).toBe('2026-09-24');
        expect(indiaDateKey(new Date('2026-09-24T18:30:00.000Z'))).toBe('2026-09-25');
    });

    it('orders deterministically for a seed and differently across days', () => {
        const ids = bank.map((q) => q.id);
        expect(seededOrder(ids, 'u1:2026-09-25')).toEqual(seededOrder(ids, 'u1:2026-09-25'));
        expect(seededOrder(ids, 'u1:2026-09-25')).not.toEqual(seededOrder(ids, 'u1:2026-09-26'));
    });

    it('prefers questions not used recently and falls back to repeats when the bank is small', () => {
        const ids = ['a', 'b', 'c', 'd', 'e'];
        const picked = pickDailyQuestions(ids, new Set(['a', 'b', 'c']), 'seed', 3);
        expect(picked.slice(0, 2).sort()).toEqual(['d', 'e']);
        expect(picked).toHaveLength(3);
        expect(pickDailyQuestions(ids, new Set(), 'seed', 10)).toHaveLength(5);
    });

    it('keeps the streak alive until today ends and breaks it on a missed day', () => {
        expect(computeQuizStreak(new Set(['2026-09-23', '2026-09-24']), '2026-09-25')).toEqual({ current: 2, doneToday: false });
        expect(computeQuizStreak(new Set(['2026-09-23', '2026-09-24', '2026-09-25']), '2026-09-25')).toEqual({ current: 3, doneToday: true });
        expect(computeQuizStreak(new Set(['2026-09-22', '2026-09-23']), '2026-09-25')).toEqual({ current: 0, doneToday: false });
        expect(computeQuizStreak(new Set(['2026-08-31', '2026-09-01']), '2026-09-01')).toEqual({ current: 2, doneToday: true });
    });
});

describe('GET /api/daily-quiz', () => {
    it('returns 10 scoped questions without the answer key', async () => {
        const response = await getDailyQuizHandler(new Request('https://api.test/api/daily-quiz'), auth, NOW);
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.quizDate).toBe('2026-09-25');
        expect(body.available).toBe(true);
        expect(body.questions).toHaveLength(10);
        expect(JSON.stringify(body.questions)).not.toContain('correctOption');
        expect(mocks.pyqFindMany.mock.calls[0]![0].where).toMatchObject({ examProgram: 'UPSC_CSE', examStage: 'PRELIMS', flaggedForReview: false });
    });

    it('skips questions that are not practice-eligible', async () => {
        wirePool([...bank.slice(0, 3), { ...bank[3]!, id: 'three-options', options: ['A', 'B', 'C'] }]);
        const body = await (await getDailyQuizHandler(new Request('https://api.test/x'), auth, NOW)).json();
        expect(body.questions.map((q: { id: string }) => q.id)).not.toContain('three-options');
        expect(body.questions).toHaveLength(3);
    });

    it('reports unavailable when the student has no questions for their exam yet', async () => {
        wirePool([]);
        const body = await (await getDailyQuizHandler(new Request('https://api.test/x'), auth, NOW)).json();
        expect(body).toMatchObject({ available: false, questions: [] });
    });

    it('returns the graded review once today is completed', async () => {
        mocks.attemptFindUnique.mockResolvedValue({ questionIds: ['q00', 'q01'], answers: { q00: 0, q01: 3 }, correctCount: 1, totalCount: 2 });
        mocks.attemptFindMany.mockResolvedValue([{ quizDate: '2026-09-25' }, { quizDate: '2026-09-24' }]);
        const body = await (await getDailyQuizHandler(new Request('https://api.test/x'), auth, NOW)).json();
        expect(body.completed).toMatchObject({ correctCount: 1, totalCount: 2 });
        expect(body.completed.review.map((r: { outcome: string }) => r.outcome)).toEqual(['CORRECT', 'INCORRECT']);
        expect(body.streak).toEqual({ current: 2, doneToday: true });
    });
});

describe('POST /api/daily-quiz/submit', () => {
    async function todaysIds(): Promise<string[]> {
        const body = await (await getDailyQuizHandler(new Request('https://api.test/x'), auth, NOW)).json();
        return body.questions.map((q: { id: string }) => q.id);
    }

    function submit(body: unknown): Request {
        return new Request('https://api.test/api/daily-quiz/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }

    it('grades server-side, saves once, and turns misses into revision cards', async () => {
        const ids = await todaysIds();
        const byId = new Map(bank.map((q) => [q.id, q]));
        const answers = Object.fromEntries(ids.map((id, index) => [id, index < 6 ? byId.get(id)!.correctOption : null]));
        const response = await submitDailyQuizHandler(submit({ questionIds: ids, answers }), auth, NOW);
        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.result).toMatchObject({ correctCount: 6, totalCount: 10, quizDate: '2026-09-25' });
        expect(mocks.attemptCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u1', quizDate: '2026-09-25', correctCount: 6 }) });
        const cards = mocks.cardCreateMany.mock.calls[0]![0].data;
        expect(cards).toHaveLength(4);
        expect(cards[0]).toMatchObject({ userId: 'u1', sourceType: 'DAILY_QUIZ', tags: ['daily-quiz', 'pyq'] });
    });

    it('rejects a submission for a different question set', async () => {
        const ids = await todaysIds();
        const response = await submitDailyQuizHandler(submit({ questionIds: [...ids].reverse(), answers: {} }), auth, NOW);
        expect(response.status).toBe(409);
        expect(mocks.attemptCreate).not.toHaveBeenCalled();
    });

    it('returns 409 on a second submission the same day', async () => {
        const ids = await todaysIds();
        mocks.attemptCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        const response = await submitDailyQuizHandler(submit({ questionIds: ids, answers: {} }), auth, NOW);
        expect(response.status).toBe(409);
    });

    it('rejects malformed answers', async () => {
        const ids = await todaysIds();
        expect((await submitDailyQuizHandler(submit({ questionIds: ids, answers: { [ids[0]!]: 7 } }), auth, NOW)).status).toBe(422);
        expect((await submitDailyQuizHandler(submit({ questionIds: [], answers: {} }), auth, NOW)).status).toBe(422);
    });
});
