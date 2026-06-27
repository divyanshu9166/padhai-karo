/**
 * Example (unit) tests for the Score-Gap service handler (task 18.3;
 * design "Target Cutoff selection & Score-Gap endpoints" section 4 + "Score-improvement gap";
 * Req 4.4, 4.5).
 *
 * These example tests pin two behaviors that depend on the handler's I/O orchestration and
 * so cannot be expressed by the pure `computeScoreGap` module alone:
 *
 *   1. Target-cutoff-required (Req 4.4) — when the user has no `TargetCollegeCutoffSelection`
 *      (`findUnique` -> `null`), the handler short-circuits with `422 TARGET_CUTOFF_REQUIRED`
 *      before computing any rank prediction.
 *   2. Reference-year reflected (Req 4.5) — with a selection present and a resolved cutoff
 *      row at a given `referenceDataYear`, a valid rank prediction yields a 200
 *      `ScoreGapResult` (GAP or MET) whose `referenceDataYear` equals the *cutoff's*
 *      reference year (distinct from the score-standing-map year, proving it is sourced
 *      from the cutoff row).
 *
 * Prisma is mocked with the `vi.hoisted` + `vi.mock('@/lib/db')` pattern (mirroring
 * `rankPredictionService.test.ts`) so the handler, the active-version resolver, and the
 * shared `computeUserRankPrediction` pipeline all read through the same in-memory client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const {
    targetSelectionFindUnique,
    cutoffFindUnique,
    profileFindUnique,
    scoreStandingAggregate,
    scoreStandingFindMany,
    externalMockFindMany,
    pyqFindMany,
    timedFindMany,
} = vi.hoisted(() => ({
    targetSelectionFindUnique: vi.fn(),
    cutoffFindUnique: vi.fn(),
    profileFindUnique: vi.fn(),
    scoreStandingAggregate: vi.fn(),
    scoreStandingFindMany: vi.fn(),
    externalMockFindMany: vi.fn(),
    pyqFindMany: vi.fn(),
    timedFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        targetCollegeCutoffSelection: { findUnique: targetSelectionFindUnique },
        cutoffReferenceData: { findUnique: cutoffFindUnique },
        profile: { findUnique: profileFindUnique },
        scoreStandingMap: { aggregate: scoreStandingAggregate, findMany: scoreStandingFindMany },
        externalMockScore: { findMany: externalMockFindMany },
        pYQAttempt: { findMany: pyqFindMany },
        timedPaperAttempt: { findMany: timedFindMany },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';
import { getScoreGapHandler } from './scoreGapService';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function getReq(): Request {
    return new Request('http://localhost/api/analytics/score-gap', { method: 'GET' });
}

// JEE score-standing bands (a subset of the seeded catalog) — contiguous over 0–100.
// A 90% normalized score falls in the [82, 92] band -> PERCENTILE estimate [98.5, 99.5].
const JEE_BANDS = [
    { minScorePercent: 0, maxScorePercent: 82, estimateLow: 0, estimateHigh: 98.5, unit: 'PERCENTILE' },
    { minScorePercent: 82, maxScorePercent: 92, estimateLow: 98.5, estimateHigh: 99.5, unit: 'PERCENTILE' },
    { minScorePercent: 92, maxScorePercent: 100, estimateLow: 99.5, estimateHigh: 100, unit: 'PERCENTILE' },
];

// >= MIN_SCORE_POINTS (3) mock scores, each 90/100 -> 90% normalized -> the [82, 92] band,
// so the rank prediction is OK (not INSUFFICIENT_DATA) with estimate { low: 98.5, high: 99.5 }.
const THREE_MOCK_SCORES = [
    { testDate: new Date('2026-01-01'), obtainedScore: 90, maxScore: 100 },
    { testDate: new Date('2026-02-01'), obtainedScore: 90, maxScore: 100 },
    { testDate: new Date('2026-03-01'), obtainedScore: 90, maxScore: 100 },
];

beforeEach(() => {
    targetSelectionFindUnique.mockReset();
    cutoffFindUnique.mockReset();
    profileFindUnique.mockReset();
    scoreStandingAggregate.mockReset();
    scoreStandingFindMany.mockReset();
    externalMockFindMany.mockReset();
    pyqFindMany.mockReset();
    timedFindMany.mockReset();
});

describe('getScoreGapHandler — example behaviors (Req 4.4, 4.5)', () => {
    it('returns 422 TARGET_CUTOFF_REQUIRED when the user has no target-cutoff selection (Req 4.4)', async () => {
        // No selection persisted for this user -> short-circuit before any prediction work.
        targetSelectionFindUnique.mockResolvedValue(null);

        const res = await getScoreGapHandler(getReq(), authCtx());

        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('TARGET_CUTOFF_REQUIRED');
        // The selection lookup is scoped to the requesting user (per-user isolation).
        expect(targetSelectionFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { userId: 'user-1' } }),
        );
        // No rank-prediction pipeline runs once the selection is missing.
        expect(cutoffFindUnique).not.toHaveBeenCalled();
        expect(profileFindUnique).not.toHaveBeenCalled();
    });

    it('reflects the cutoff reference-data year on a 200 GAP result (Req 4.5)', async () => {
        // The cutoff dataset year is intentionally distinct from the standing-map year, so
        // asserting it appears on the result proves the year is sourced from the cutoff row.
        const CUTOFF_YEAR = 2025;
        const STANDING_MAP_YEAR = 2026;

        targetSelectionFindUnique.mockResolvedValue({
            userId: 'user-1',
            cutoffReferenceId: 'cutoff-1',
        });
        // Closing percentile 100 with the optimistic predicted percentile 99.5 -> a GAP of 0.5.
        cutoffFindUnique.mockResolvedValue({
            closingValue: 100,
            unit: 'PERCENTILE',
            referenceDataYear: CUTOFF_YEAR,
        });

        // Rank-prediction pipeline: JEE profile, active standing-map year, bands, score points.
        profileFindUnique.mockResolvedValue({ examTrack: 'JEE' });
        scoreStandingAggregate.mockResolvedValue({ _max: { referenceDataYear: STANDING_MAP_YEAR } });
        scoreStandingFindMany.mockResolvedValue(JEE_BANDS);
        externalMockFindMany.mockResolvedValue(THREE_MOCK_SCORES);
        pyqFindMany.mockResolvedValue([]);
        timedFindMany.mockResolvedValue([]);

        const res = await getScoreGapHandler(getReq(), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            kind: string;
            gap?: number;
            margin?: number;
            unit: string;
            referenceDataYear: number;
        };
        // PERCENTILE is higher-is-better: comparable standing = estimate.high (99.5) < 100 -> GAP.
        expect(body.kind).toBe('GAP');
        expect(body.gap).toBeCloseTo(0.5, 5);
        expect(body.unit).toBe('PERCENTILE');
        // The result carries the CUTOFF's reference year, not the standing-map year (Req 4.5).
        expect(body.referenceDataYear).toBe(CUTOFF_YEAR);
        expect(body.referenceDataYear).not.toBe(STANDING_MAP_YEAR);
        // The cutoff row was resolved from the user's selection.
        expect(cutoffFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'cutoff-1' } }),
        );
    });
});
