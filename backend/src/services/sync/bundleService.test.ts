import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the offline paper-bundle download (task 18.1).
 *
 * The handler is exercised against a mocked Prisma client so we never touch a live
 * database. We assert it returns the paper + its questions + its answer key for offline use
 * (Req 21.1), that the bundle deliberately INCLUDES the answer key (the documented
 * offline difference), and that a missing paper yields 404.
 *
 * Validates: Requirements 21.1
 */
const { findUniquePaper } = vi.hoisted(() => ({ findUniquePaper: vi.fn() }));

vi.mock('@/lib/db', () => {
    const prisma = { pYQPaper: { findUnique: findUniquePaper } };
    return { default: prisma, prisma };
});

import { getPaperBundleHandler } from './bundleService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

const routeCtx = (id: string) => ({ params: { id } });

beforeEach(() => {
    findUniquePaper.mockReset();
});

describe('getPaperBundleHandler', () => {
    it('returns 422 when the paper id is blank', async () => {
        const res = await getPaperBundleHandler(
            new Request('http://localhost/api/offline/papers//bundle'),
            authCtx(),
            routeCtx('   '),
        );
        expect(res.status).toBe(422);
        expect(findUniquePaper).not.toHaveBeenCalled();
    });

    it('returns 404 when the paper does not exist', async () => {
        findUniquePaper.mockResolvedValue(null);
        const res = await getPaperBundleHandler(
            new Request('http://localhost/api/offline/papers/missing/bundle'),
            authCtx(),
            routeCtx('missing'),
        );
        expect(res.status).toBe(404);
    });

    it('returns the paper (with questions) and its answer key for offline download', async () => {
        findUniquePaper.mockResolvedValue({
            id: 'paper-1',
            examTrack: 'JEE_MAIN',
            year: 2024,
            session: 'S1',
            durationMin: 180,
            questions: [
                {
                    id: 'q1',
                    examTrack: 'JEE_MAIN',
                    year: 2024,
                    subjectId: 'subj-1',
                    questionText: 'Q1?',
                    options: ['a', 'b', 'c', 'd'],
                    correctOption: 2,
                    flaggedForReview: false,
                },
            ],
            answerKey: { id: 'ak-1', paperId: 'paper-1', entries: { q1: 2 } },
        });

        const res = await getPaperBundleHandler(
            new Request('http://localhost/api/offline/papers/paper-1/bundle'),
            authCtx(),
            routeCtx('paper-1'),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            paper: { id: string; questions: Array<{ id: string; correctOption: number }> };
            answerKey: { id: string; entries: Record<string, number> };
        };

        // Paper carries its questions, and the bundle INCLUDES the answer key offline.
        expect(body.paper.id).toBe('paper-1');
        expect(body.paper.questions[0].id).toBe('q1');
        expect(body.paper.questions[0].correctOption).toBe(2);
        expect(body.answerKey).toEqual({ id: 'ak-1', paperId: 'paper-1', entries: { q1: 2 } });

        // answerKey is split out to the top level, not nested under paper.
        expect(
            (body.paper as unknown as { answerKey?: unknown }).answerKey,
        ).toBeUndefined();
    });
});
