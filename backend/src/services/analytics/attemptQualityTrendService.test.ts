/**
 * Example (unit) test for the Attempt Quality Trend service handler (task 22.2;
 * design "Attempt Quality Trend endpoint (Req 10)"; Req 10.2).
 *
 * Req 10.2 requires that the Attempt_Quality_Trend be reported SEPARATELY from the
 * content-knowledge metrics of the Score_Trajectory. The pure modules cannot express this on
 * their own because "reported separately" is a property of the two HANDLERS' response
 * payloads, not of a single computation. This example therefore seeds the SAME underlying
 * user attempts behind both handlers and asserts that:
 *
 *   1. `getAttemptQualityTrendHandler` returns the discriminated trend payload — a `kind`
 *      ('OK' | 'INSUFFICIENT_DATA'), and on OK a `series` plus `accuracyDirection` /
 *      `attemptRateDirection` — and NOT the score-trajectory `{ points }` shape.
 *   2. `getScoreTrajectoryHandler` returns the score-trajectory `{ points: [...] }` payload,
 *      and NOT the trend's `series` / `kind` shape.
 *   3. The two payloads are structurally distinct, demonstrating they are reported separately.
 *
 * Prisma is mocked with the `vi.hoisted` + `vi.mock('@/lib/db')` pattern (mirroring
 * `rankPredictionService.test.ts`) so both handlers read the same in-memory rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const { pyqAttemptFindMany, timedAttemptFindMany, externalMockFindMany, pyqFindMany } = vi.hoisted(
    () => ({
        pyqAttemptFindMany: vi.fn(),
        timedAttemptFindMany: vi.fn(),
        externalMockFindMany: vi.fn(),
        pyqFindMany: vi.fn(),
    }),
);

vi.mock('@/lib/db', () => {
    const prisma = {
        pYQAttempt: { findMany: pyqAttemptFindMany },
        timedPaperAttempt: { findMany: timedAttemptFindMany },
        externalMockScore: { findMany: externalMockFindMany },
        pYQ: { findMany: pyqFindMany },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';

import { getAttemptQualityTrendHandler } from './attemptQualityTrendService';
import { getScoreTrajectoryHandler } from './scoreTrajectoryService';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function trendReq(): Request {
    return new Request('http://localhost/api/analytics/attempt-quality-trend', { method: 'GET' });
}

function trajectoryReq(): Request {
    return new Request('http://localhost/api/analytics/score-trajectory', { method: 'GET' });
}

// The SAME underlying user attempts seeded behind BOTH handlers. Two PYQ attempts (>= 2) so
// the trend resolves to an OK result with a series rather than INSUFFICIENT_DATA. Each row
// carries every field either handler selects (createdAt, totalScore, perQuestion); the mocked
// findMany ignores the per-handler `select` and returns the row as-is.
const PYQ_ATTEMPTS = [
    {
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        totalScore: 1,
        perQuestion: [
            { questionId: 'q1', outcome: 'CORRECT' },
            { questionId: 'q2', outcome: 'INCORRECT' },
        ],
    },
    {
        createdAt: new Date('2024-02-01T00:00:00.000Z'),
        totalScore: 2,
        perQuestion: [
            { questionId: 'q1', outcome: 'CORRECT' },
            { questionId: 'q2', outcome: 'CORRECT' },
        ],
    },
];

const EXTERNAL_MOCK_SCORES = [
    { testDate: new Date('2024-01-15T00:00:00.000Z'), obtainedScore: 80, maxScore: 100 },
];

const PYQ_ROWS = [
    { id: 'q1', subjectId: 'physics' },
    { id: 'q2', subjectId: 'physics' },
];

beforeEach(() => {
    pyqAttemptFindMany.mockReset();
    timedAttemptFindMany.mockReset();
    externalMockFindMany.mockReset();
    pyqFindMany.mockReset();

    // Seed the same underlying attempts for both handlers.
    pyqAttemptFindMany.mockResolvedValue(PYQ_ATTEMPTS);
    timedAttemptFindMany.mockResolvedValue([]);
    externalMockFindMany.mockResolvedValue(EXTERNAL_MOCK_SCORES);
    pyqFindMany.mockResolvedValue(PYQ_ROWS);
});

describe('Attempt Quality Trend is reported separately from the Score Trajectory (Req 10.2)', () => {
    it('the trend handler returns the trend payload shape, not the score-trajectory shape', async () => {
        const res = await getAttemptQualityTrendHandler(trendReq(), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;

        // The trend payload is the discriminated trend result.
        expect(body.kind).toBeDefined();
        expect(['OK', 'INSUFFICIENT_DATA']).toContain(body.kind);

        // With two attempts seeded it resolves to OK with the trend's distinctive fields.
        expect(body.kind).toBe('OK');
        expect(Array.isArray(body.series)).toBe(true);
        expect(body.accuracyDirection).toBeDefined();
        expect(body.attemptRateDirection).toBeDefined();

        // It is NOT the score-trajectory `{ points }` payload.
        expect(body.points).toBeUndefined();
    });

    it('the trajectory handler returns the score-trajectory shape, not the trend shape', async () => {
        const res = await getScoreTrajectoryHandler(trajectoryReq(), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;

        // The trajectory payload is `{ points: [...] }`.
        expect(Array.isArray(body.points)).toBe(true);

        // It is NOT the trend payload: no `series` and no `kind` discriminant.
        expect(body.series).toBeUndefined();
        expect(body.kind).toBeUndefined();
    });

    it('the two payloads are structurally distinct over the same seeded attempts', async () => {
        const trendRes = await getAttemptQualityTrendHandler(trendReq(), authCtx());
        const trajectoryRes = await getScoreTrajectoryHandler(trajectoryReq(), authCtx());

        expect(trendRes.status).toBe(200);
        expect(trajectoryRes.status).toBe(200);

        const trend = (await trendRes.json()) as Record<string, unknown>;
        const trajectory = (await trajectoryRes.json()) as Record<string, unknown>;

        // The trend response has no `points` array; the trajectory response has no
        // `series`/`kind` — the payloads do not share their distinguishing keys, so the
        // attempt-quality trend is reported separately from the score trajectory (Req 10.2).
        expect('points' in trend).toBe(false);
        expect('series' in trajectory).toBe(false);
        expect('kind' in trajectory).toBe(false);

        expect('series' in trend).toBe(true);
        expect('points' in trajectory).toBe(true);

        // Sanity: both were computed from the same seeded attempt store.
        expect(pyqAttemptFindMany).toHaveBeenCalled();
    });
});
