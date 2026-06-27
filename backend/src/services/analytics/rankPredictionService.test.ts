/**
 * Example (unit) tests for the Rank Prediction service handler (task 17.2;
 * design "Rank Prediction endpoint (Req 3)" + reference-data versioning; Req 3.5, 5.4).
 *
 * These example tests pin two reference-data behaviors the pure modules cannot express on
 * their own because they depend on the handler's I/O orchestration:
 *
 *   1. Reference-year reflected (Req 3.5, 5.2) — when several `ScoreStandingMap` years exist
 *      for the user's track, the handler must select the MAX year (via the shared
 *      active-version resolver) and echo it as `referenceDataYear` on a 200 OK payload.
 *   2. Reference-unavailable (Req 5.4) — when no `ScoreStandingMap` rows exist for the track
 *      (the resolver's `_max.referenceDataYear` is `null`), the handler returns
 *      `503 REFERENCE_DATA_UNAVAILABLE`.
 *
 * Prisma is mocked with the `vi.hoisted` + `vi.mock('@/lib/db')` pattern (mirroring
 * `services/pyq/coreTierAccess.property.test.ts`) so the handler and the active-version
 * resolver it calls both read through the same in-memory client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const {
    profileFindUnique,
    scoreStandingAggregate,
    scoreStandingFindMany,
    externalMockFindMany,
    pyqFindMany,
    timedFindMany,
} = vi.hoisted(() => ({
    profileFindUnique: vi.fn(),
    scoreStandingAggregate: vi.fn(),
    scoreStandingFindMany: vi.fn(),
    externalMockFindMany: vi.fn(),
    pyqFindMany: vi.fn(),
    timedFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        scoreStandingMap: { aggregate: scoreStandingAggregate, findMany: scoreStandingFindMany },
        externalMockScore: { findMany: externalMockFindMany },
        pYQAttempt: { findMany: pyqFindMany },
        timedPaperAttempt: { findMany: timedFindMany },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';
import { getRankPredictionHandler } from './rankPredictionService';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function getReq(): Request {
    return new Request('http://localhost/api/analytics/rank-prediction', { method: 'GET' });
}

// JEE score-standing bands (a subset of the seeded 2024 catalog) — contiguous over 0–100.
// A 90% normalized score falls in the [82, 92] band -> PERCENTILE [98.5, 99.5].
const JEE_BANDS = [
    { minScorePercent: 0, maxScorePercent: 82, estimateLow: 0, estimateHigh: 98.5, unit: 'PERCENTILE' },
    { minScorePercent: 82, maxScorePercent: 92, estimateLow: 98.5, estimateHigh: 99.5, unit: 'PERCENTILE' },
    { minScorePercent: 92, maxScorePercent: 100, estimateLow: 99.5, estimateHigh: 100, unit: 'PERCENTILE' },
];

beforeEach(() => {
    profileFindUnique.mockReset();
    scoreStandingAggregate.mockReset();
    scoreStandingFindMany.mockReset();
    externalMockFindMany.mockReset();
    pyqFindMany.mockReset();
    timedFindMany.mockReset();
});

describe('getRankPredictionHandler — reference-data behavior (Req 3.5, 5.4)', () => {
    it('reflects the MAX reference-data year in a 200 OK payload (Req 3.5, 5.2)', async () => {
        // Several years exist for the track; the active-version resolver picks the maximum.
        const maxYear = 2026;
        profileFindUnique.mockResolvedValue({ examTrack: 'JEE' });
        // aggregate({ _max: { referenceDataYear } }) returns the most-recent year (Req 5.2).
        scoreStandingAggregate.mockResolvedValue({ _max: { referenceDataYear: maxYear } });
        // The handler loads that year's bands for the track.
        scoreStandingFindMany.mockResolvedValue(JEE_BANDS);
        // >= MIN_SCORE_POINTS (3) score points so the prediction is OK, not INSUFFICIENT_DATA.
        // Each 90/100 mock score normalizes to 90% -> the [82, 92] band.
        externalMockFindMany.mockResolvedValue([
            { testDate: new Date('2026-01-01'), obtainedScore: 90, maxScore: 100 },
            { testDate: new Date('2026-02-01'), obtainedScore: 90, maxScore: 100 },
            { testDate: new Date('2026-03-01'), obtainedScore: 90, maxScore: 100 },
        ]);
        pyqFindMany.mockResolvedValue([]);
        timedFindMany.mockResolvedValue([]);

        const res = await getRankPredictionHandler(getReq(), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            kind: string;
            track: string;
            estimate: { low: number; high: number; unit: string };
            referenceDataYear: number;
        };
        expect(body.kind).toBe('OK');
        expect(body.track).toBe('JEE');
        expect(body.estimate.unit).toBe('PERCENTILE');
        // The MAX year is selected and echoed back (Req 3.5, 5.2).
        expect(body.referenceDataYear).toBe(maxYear);
        // The resolver was scoped to the user's track.
        expect(scoreStandingAggregate).toHaveBeenCalledWith(
            expect.objectContaining({ where: { examTrack: 'JEE' } }),
        );
        // The bands were loaded for the resolved max year.
        expect(scoreStandingFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { examTrack: 'JEE', referenceDataYear: maxYear } }),
        );
    });

    it('returns 503 REFERENCE_DATA_UNAVAILABLE when no standing-map rows exist for the track (Req 5.4)', async () => {
        profileFindUnique.mockResolvedValue({ examTrack: 'NEET' });
        // No rows for the track -> aggregate _max.referenceDataYear is null (Req 5.4).
        scoreStandingAggregate.mockResolvedValue({ _max: { referenceDataYear: null } });

        const res = await getRankPredictionHandler(getReq(), authCtx());

        expect(res.status).toBe(503);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('REFERENCE_DATA_UNAVAILABLE');
        // No band/point loading happens once the reference year is unavailable.
        expect(scoreStandingFindMany).not.toHaveBeenCalled();
    });
});
