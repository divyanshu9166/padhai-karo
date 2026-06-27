import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the PYQ practice retrieval service (task 11.2).
 *
 * The pure helpers (validation, where-clause building, client projection) are exercised
 * directly. The handler is exercised against a mocked Prisma client so we never touch a
 * live database — we only assert the behaviour the task specifies: validation (422),
 * track-scoping from the Profile, exclusion of flagged questions, and that the response
 * omits `correctOption`.
 *
 * Validates: Requirements 6.1, 7.3 (and 6.6/9.4 — no tier gating)
 */

// --- Prisma mock -------------------------------------------------------------
// `vi.mock` is hoisted above the module body, so the mock fns must be created via
// `vi.hoisted` to be available inside the (also hoisted) factory.
const { findUniqueProfile, findManyPyq } = vi.hoisted(() => ({
    findUniqueProfile: vi.fn(),
    findManyPyq: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: findUniqueProfile },
        pYQ: { findMany: findManyPyq },
    };
    return { default: prisma, prisma };
});

import {
    buildPyqWhere,
    parseSubjectIdParam,
    parseYearParam,
    PYQ_CLIENT_SELECT,
    pyqsHandler,
    toClientPyq,
} from './pyqService';
import type { AuthContext } from '@/lib/auth';

const BASE = 'http://localhost/api/pyqs';

function get(query: string): Request {
    return new Request(`${BASE}${query}`);
}

function authCtx(userId = 'user-1'): AuthContext {
    // Only `user.id` is read by the handler; the rest is irrelevant to these tests.
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

beforeEach(() => {
    findUniqueProfile.mockReset();
    findManyPyq.mockReset();
});

describe('parseYearParam', () => {
    it('accepts a canonical integer year', () => {
        const parsed = parseYearParam(new URL(`${BASE}?year=2024`));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.year).toBe(2024);
        }
    });

    it.each(['', 'abc', '2024.5', '0x7e0', '  '])(
        'rejects non-integer year %j with a 422 response',
        (year) => {
            const parsed = parseYearParam(new URL(`${BASE}?year=${encodeURIComponent(year)}`));
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) {
                expect(parsed.response.status).toBe(422);
            }
        },
    );

    it('rejects a missing year with a 422 response', () => {
        const parsed = parseYearParam(new URL(BASE));
        expect(parsed.ok).toBe(false);
    });
});

describe('parseSubjectIdParam', () => {
    it('accepts a non-blank subjectId (trimmed)', () => {
        const parsed = parseSubjectIdParam(new URL(`${BASE}?subjectId=%20subj-1%20`));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.subjectId).toBe('subj-1');
        }
    });

    it.each(['', '   '])('rejects missing/blank subjectId %j with a 422 response', (subjectId) => {
        const parsed = parseSubjectIdParam(
            new URL(`${BASE}?subjectId=${encodeURIComponent(subjectId)}`),
        );
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.response.status).toBe(422);
        }
    });

    it('rejects an entirely absent subjectId with a 422 response', () => {
        const parsed = parseSubjectIdParam(new URL(BASE));
        expect(parsed.ok).toBe(false);
    });
});

describe('buildPyqWhere', () => {
    it('pins examTrack, year, subjectId, and always flaggedForReview:false (Req 6.1, 7.3)', () => {
        const where = buildPyqWhere({ examTrack: 'JEE', year: 2024, subjectId: 'subj-1' });
        expect(where).toEqual({
            examTrack: 'JEE',
            year: 2024,
            subjectId: 'subj-1',
            flaggedForReview: false,
        });
    });

    it('excludes flagged questions for either track', () => {
        for (const examTrack of ['JEE', 'NEET'] as const) {
            const where = buildPyqWhere({ examTrack, year: 2023, subjectId: 's' });
            expect(where.flaggedForReview).toBe(false);
            expect(where.examTrack).toBe(examTrack);
        }
    });
});

describe('PYQ_CLIENT_SELECT', () => {
    it('selects only the safe client columns and never correctOption', () => {
        expect(PYQ_CLIENT_SELECT).toEqual({ id: true, questionText: true, options: true });
        expect('correctOption' in PYQ_CLIENT_SELECT).toBe(false);
        expect('flaggedForReview' in PYQ_CLIENT_SELECT).toBe(false);
    });
});

describe('toClientPyq', () => {
    it('projects to { id, questionText, options } and omits answer-revealing fields', () => {
        const projected = toClientPyq({
            id: 'q1',
            questionText: 'What is 2 + 2?',
            options: ['1', '2', '3', '4'],
            // Extra fields that must never survive the projection.
            correctOption: 3,
            flaggedForReview: false,
        } as unknown as Parameters<typeof toClientPyq>[0]);

        expect(projected).toEqual({
            id: 'q1',
            questionText: 'What is 2 + 2?',
            options: ['1', '2', '3', '4'],
        });
        expect('correctOption' in projected).toBe(false);
        expect('flaggedForReview' in projected).toBe(false);
    });
});

describe('pyqsHandler', () => {
    it('returns 422 when year is missing/invalid (no DB access)', async () => {
        const res = await pyqsHandler(get('?subjectId=subj-1'), authCtx());
        expect(res.status).toBe(422);
        expect(findUniqueProfile).not.toHaveBeenCalled();
        expect(findManyPyq).not.toHaveBeenCalled();
    });

    it('returns 422 when subjectId is missing', async () => {
        const res = await pyqsHandler(get('?year=2024'), authCtx());
        expect(res.status).toBe(422);
        expect(findManyPyq).not.toHaveBeenCalled();
    });

    it('returns 404 when the user has no profile (no exam track)', async () => {
        findUniqueProfile.mockResolvedValue(null);
        const res = await pyqsHandler(get('?year=2024&subjectId=subj-1'), authCtx());
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('NOT_FOUND');
        expect(findManyPyq).not.toHaveBeenCalled();
    });

    it("filters by the user's track + year + subject, excludes flagged, and omits correctOption", async () => {
        findUniqueProfile.mockResolvedValue({ examTrack: 'NEET' });
        findManyPyq.mockResolvedValue([
            { id: 'q1', questionText: 'Q1', options: ['a', 'b', 'c', 'd'] },
            { id: 'q2', questionText: 'Q2', options: ['a', 'b', 'c', 'd'] },
        ]);

        const res = await pyqsHandler(get('?year=2024&subjectId=subj-1'), authCtx('user-42'));
        expect(res.status).toBe(200);

        // Profile is looked up scoped to the authenticated user.
        expect(findUniqueProfile).toHaveBeenCalledWith({
            where: { userId: 'user-42' },
            select: { examTrack: true },
        });

        // The query pins the track from the profile, the requested year/subject, and
        // flaggedForReview:false, and only selects the safe columns.
        expect(findManyPyq).toHaveBeenCalledWith({
            where: {
                examTrack: 'NEET',
                year: 2024,
                subjectId: 'subj-1',
                flaggedForReview: false,
            },
            select: PYQ_CLIENT_SELECT,
            orderBy: { id: 'asc' },
        });

        const body = (await res.json()) as { questions: Array<Record<string, unknown>> };
        expect(body.questions).toHaveLength(2);
        for (const q of body.questions) {
            expect(Object.keys(q).sort()).toEqual(['id', 'options', 'questionText']);
            expect('correctOption' in q).toBe(false);
        }
    });
});
