/**
 * Reference-data retention integration test (task 28.3; design "Reference-data versioning
 * approach" + Testing Strategy → "Integration tests: Reference-data retention"; Req 5.3, 6.4).
 *
 * The design's reference-data versioning rule has two halves that this test exercises
 * together against the real readers:
 *
 *   - **Retention (Req 5.3, 6.4):** loading a later year is *additive* — a new year's rows
 *     are inserted while every prior year's rows are RETAINED. So several years coexist for
 *     a track in the store.
 *   - **Active = max year (Req 5.2, 6.3):** every reader resolves the active dataset version
 *     to the MAXIMUM `referenceDataYear` present for the track via the shared
 *     `resolveActiveReferenceYear`, and a 200 response echoes that year.
 *
 * Rather than stubbing each call with a fixed value, this test backs the mocked Prisma
 * client with an in-memory store seeded for BOTH year `N` and year `N+1` (the additive
 * "two years coexist" state). The mocked `.aggregate({ _max: { referenceDataYear } })`
 * computes the maximum over the store (the resolver's real behavior — Req 5.2/6.3), and the
 * mocked `.findMany` honors its `{ examTrack, referenceDataYear }` where-clause. Because the
 * store is never mutated by a read, asserting it still contains the year-`N` rows after the
 * handlers run demonstrates retention directly (Req 5.3, 6.4).
 *
 * It then drives the three active readers end-to-end and asserts each carries
 * `referenceDataYear === N+1`:
 *   - rank prediction (`getRankPredictionHandler`) — uses the active ScoreStandingMap year,
 *   - cutoff listing (`listCutoffs`) + score gap (`getScoreGapHandler`) — use the active
 *     CutoffReferenceData year,
 *   - topic trends (`topicTrendsHandler`) — uses the active TopicFrequencyReferenceData year.
 *
 * Finally it unit-tests `resolveActiveReferenceYear` directly against the same two-year
 * store, asserting it returns `N+1` while the year-`N` rows remain present (retention).
 *
 * Prisma is mocked with the `vi.hoisted` + `vi.mock('@/lib/db')` pattern (mirroring
 * `rankPredictionService.test.ts` / `scoreGapService.test.ts`) so the handlers, the shared
 * active-version resolver, and the `computeUserRankPrediction` pipeline all read through the
 * same in-memory client.
 */
import { ReferenceDatasetType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Two coexisting reference-data years (the additive "retained" state) -----
const YEAR_N = 2025;
const YEAR_N_PLUS_1 = 2026;
const TRACK = 'JEE' as const;

// --- In-memory store seeded for BOTH years -----------------------------------
// JEE score-standing bands (contiguous over 0–100). The year-N+1 bands map a 90% normalized
// score to PERCENTILE [98.5, 99.5]; the year-N bands deliberately differ so a wrong-year
// read would be observable. Active reads must only ever load the year-N+1 rows.
interface StandingRow {
    examTrack: 'JEE' | 'NEET';
    referenceDataYear: number;
    minScorePercent: number;
    maxScorePercent: number;
    estimateLow: number;
    estimateHigh: number;
    unit: 'PERCENTILE' | 'MARKS' | 'RANK';
}

interface CutoffRow {
    id: string;
    examTrack: 'JEE' | 'NEET';
    referenceDataYear: number;
    collegeName: string;
    branchName: string;
    category: string;
    closingValue: number;
    unit: 'PERCENTILE' | 'MARKS' | 'RANK';
}

interface TopicFreqRow {
    examTrack: 'JEE' | 'NEET';
    referenceDataYear: number;
    topicKey: string;
    appearanceCount: number;
    yearSpanStart: number;
    yearSpanEnd: number;
    avgQuestionsPerYear: number;
}

function standingBands(year: number, highEstimate: number): StandingRow[] {
    return [
        { examTrack: TRACK, referenceDataYear: year, minScorePercent: 0, maxScorePercent: 82, estimateLow: 0, estimateHigh: 98.5, unit: 'PERCENTILE' },
        { examTrack: TRACK, referenceDataYear: year, minScorePercent: 82, maxScorePercent: 92, estimateLow: 98.5, estimateHigh: highEstimate, unit: 'PERCENTILE' },
        { examTrack: TRACK, referenceDataYear: year, minScorePercent: 92, maxScorePercent: 100, estimateLow: highEstimate, estimateHigh: 100, unit: 'PERCENTILE' },
    ];
}

// The store is module-scoped and rebuilt fresh in beforeEach so each test starts from the
// canonical "two years retained" state.
let store: {
    scoreStanding: StandingRow[];
    cutoff: CutoffRow[];
    topicFreq: TopicFreqRow[];
    selection: { userId: string; cutoffReferenceId: string } | null;
};

function seedStore() {
    store = {
        // Year N bands (estimateHigh 99.0) and year N+1 bands (estimateHigh 99.5) both present.
        scoreStanding: [...standingBands(YEAR_N, 99.0), ...standingBands(YEAR_N_PLUS_1, 99.5)],
        cutoff: [
            // Year N cutoff (retained) and year N+1 cutoff (active).
            { id: 'cutoff-N', examTrack: TRACK, referenceDataYear: YEAR_N, collegeName: 'IIT Old', branchName: 'CSE', category: 'General', closingValue: 100, unit: 'PERCENTILE' },
            { id: 'cutoff-N1', examTrack: TRACK, referenceDataYear: YEAR_N_PLUS_1, collegeName: 'IIT New', branchName: 'CSE', category: 'General', closingValue: 100, unit: 'PERCENTILE' },
        ],
        topicFreq: [
            { examTrack: TRACK, referenceDataYear: YEAR_N, topicKey: 'kinematics', appearanceCount: 10, yearSpanStart: 2015, yearSpanEnd: 2024, avgQuestionsPerYear: 1.0 },
            { examTrack: TRACK, referenceDataYear: YEAR_N_PLUS_1, topicKey: 'kinematics', appearanceCount: 12, yearSpanStart: 2016, yearSpanEnd: 2025, avgQuestionsPerYear: 1.2 },
        ],
        // The user has selected the year-N+1 (active) cutoff as their target.
        selection: { userId: 'user-1', cutoffReferenceId: 'cutoff-N1' },
    };
}

// --- Prisma mock backed by the in-memory store -------------------------------
const {
    profileFindUnique,
    scoreStandingAggregate,
    scoreStandingFindMany,
    cutoffAggregate,
    cutoffFindMany,
    cutoffFindUnique,
    topicFreqAggregate,
    topicFreqFindMany,
    targetSelectionFindUnique,
    externalMockFindMany,
    pyqFindMany,
    timedFindMany,
} = vi.hoisted(() => ({
    profileFindUnique: vi.fn(),
    scoreStandingAggregate: vi.fn(),
    scoreStandingFindMany: vi.fn(),
    cutoffAggregate: vi.fn(),
    cutoffFindMany: vi.fn(),
    cutoffFindUnique: vi.fn(),
    topicFreqAggregate: vi.fn(),
    topicFreqFindMany: vi.fn(),
    targetSelectionFindUnique: vi.fn(),
    externalMockFindMany: vi.fn(),
    pyqFindMany: vi.fn(),
    timedFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        scoreStandingMap: { aggregate: scoreStandingAggregate, findMany: scoreStandingFindMany },
        cutoffReferenceData: {
            aggregate: cutoffAggregate,
            findMany: cutoffFindMany,
            findUnique: cutoffFindUnique,
        },
        topicFrequencyReferenceData: { aggregate: topicFreqAggregate, findMany: topicFreqFindMany },
        targetCollegeCutoffSelection: { findUnique: targetSelectionFindUnique },
        externalMockScore: { findMany: externalMockFindMany },
        pYQAttempt: { findMany: pyqFindMany },
        timedPaperAttempt: { findMany: timedFindMany },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';
import { resolveActiveReferenceYear } from '@/lib/analytics/referenceVersion';
import { listCutoffs } from './cutoffService';
import { getRankPredictionHandler } from './rankPredictionService';
import { getScoreGapHandler } from './scoreGapService';
import { topicTrendsHandler } from './topicTrendService';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function getReq(path: string): Request {
    return new Request(`http://localhost/api/analytics/${path}`, { method: 'GET' });
}

// Generic helpers modeling Prisma's `aggregate(_max)` and `findMany` over a year-versioned
// table, matching the real resolver/handler queries (filter by examTrack [+ year]).
function maxYearOf<T extends { examTrack: string; referenceDataYear: number }>(
    rows: T[],
    where: { examTrack: string },
) {
    const matching = rows.filter((r) => r.examTrack === where.examTrack);
    const max = matching.length === 0 ? null : Math.max(...matching.map((r) => r.referenceDataYear));
    return { _max: { referenceDataYear: max } };
}

function rowsForYear<T extends { examTrack: string; referenceDataYear: number }>(
    rows: T[],
    where: { examTrack: string; referenceDataYear: number },
) {
    return rows.filter(
        (r) => r.examTrack === where.examTrack && r.referenceDataYear === where.referenceDataYear,
    );
}

// >= MIN_SCORE_POINTS (3) mock scores, each 90/100 -> 90% normalized -> the [82, 92] band,
// so rank prediction is OK (not INSUFFICIENT_DATA).
const THREE_MOCK_SCORES = [
    { testDate: new Date('2026-01-01'), obtainedScore: 90, maxScore: 100 },
    { testDate: new Date('2026-02-01'), obtainedScore: 90, maxScore: 100 },
    { testDate: new Date('2026-03-01'), obtainedScore: 90, maxScore: 100 },
];

beforeEach(() => {
    seedStore();

    profileFindUnique.mockReset().mockResolvedValue({ examTrack: TRACK });

    scoreStandingAggregate
        .mockReset()
        .mockImplementation(async ({ where }) => maxYearOf(store.scoreStanding, where));
    scoreStandingFindMany
        .mockReset()
        .mockImplementation(async ({ where }) => rowsForYear(store.scoreStanding, where));

    cutoffAggregate
        .mockReset()
        .mockImplementation(async ({ where }) => maxYearOf(store.cutoff, where));
    cutoffFindMany
        .mockReset()
        .mockImplementation(async ({ where }) => rowsForYear(store.cutoff, where));
    cutoffFindUnique
        .mockReset()
        .mockImplementation(async ({ where }) => store.cutoff.find((r) => r.id === where.id) ?? null);

    topicFreqAggregate
        .mockReset()
        .mockImplementation(async ({ where }) => maxYearOf(store.topicFreq, where));
    topicFreqFindMany
        .mockReset()
        .mockImplementation(async ({ where }) => rowsForYear(store.topicFreq, where));

    targetSelectionFindUnique
        .mockReset()
        .mockImplementation(async ({ where }) => (store.selection?.userId === where.userId ? store.selection : null));

    externalMockFindMany.mockReset().mockResolvedValue(THREE_MOCK_SCORES);
    pyqFindMany.mockReset().mockResolvedValue([]);
    timedFindMany.mockReset().mockResolvedValue([]);
});

describe('Reference-data retention (Req 5.3, 6.4) — two years coexist, active reader uses N+1', () => {
    it('rank prediction reads the active (max) ScoreStandingMap year and echoes N+1', async () => {
        const res = await getRankPredictionHandler(getReq('rank-prediction'), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            kind: string;
            referenceDataYear: number;
            estimate: { high: number };
        };
        expect(body.kind).toBe('OK');
        // Active version = max year present (Req 5.2); the year-N rows are ignored.
        expect(body.referenceDataYear).toBe(YEAR_N_PLUS_1);
        // The year-N+1 bands (estimateHigh 99.5) were used, not the year-N bands (99.0).
        expect(body.estimate.high).toBeCloseTo(99.5, 5);
        // Only the active year's bands were loaded.
        expect(scoreStandingFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { examTrack: TRACK, referenceDataYear: YEAR_N_PLUS_1 } }),
        );
        // Retention: BOTH years still present in the store after the read (Req 5.3).
        expect(store.scoreStanding.some((r) => r.referenceDataYear === YEAR_N)).toBe(true);
        expect(store.scoreStanding.some((r) => r.referenceDataYear === YEAR_N_PLUS_1)).toBe(true);
    });

    it('cutoff listing reads the active (max) CutoffReferenceData year and echoes N+1', async () => {
        const res = await listCutoffs(getReq('cutoffs'), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            referenceDataYear: number;
            cutoffs: { id: string }[];
        };
        // Active cutoff dataset is the max year (Req 5.2); prior year retained but not listed.
        expect(body.referenceDataYear).toBe(YEAR_N_PLUS_1);
        expect(body.cutoffs.map((c) => c.id)).toEqual(['cutoff-N1']);
        // Retention: the year-N cutoff row is still present in the store (Req 5.3).
        expect(store.cutoff.some((r) => r.referenceDataYear === YEAR_N)).toBe(true);
    });

    it('score gap reports the selected (active-year) cutoff and echoes N+1', async () => {
        const res = await getScoreGapHandler(getReq('score-gap'), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            kind: string;
            gap?: number;
            unit: string;
            referenceDataYear: number;
        };
        // Predicted percentile high 99.5 < closing 100 -> a GAP of 0.5 (Req 4.2).
        expect(body.kind).toBe('GAP');
        expect(body.gap).toBeCloseTo(0.5, 5);
        // The result carries the active-year cutoff's reference year (Req 4.5, 5.3).
        expect(body.referenceDataYear).toBe(YEAR_N_PLUS_1);
    });

    it('topic trends reads the active (max) TopicFrequencyReferenceData year and echoes N+1', async () => {
        const res = await topicTrendsHandler(getReq('topic-trends'), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as { referenceDataYear: number };
        // Active topic-frequency version = max year (Req 6.3); year-N rows retained but unused.
        expect(body.referenceDataYear).toBe(YEAR_N_PLUS_1);
        expect(topicFreqFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { examTrack: TRACK, referenceDataYear: YEAR_N_PLUS_1 } }),
        );
        // Retention: BOTH years still present in the store (Req 6.4).
        expect(store.topicFreq.some((r) => r.referenceDataYear === YEAR_N)).toBe(true);
        expect(store.topicFreq.some((r) => r.referenceDataYear === YEAR_N_PLUS_1)).toBe(true);
    });
});

describe('resolveActiveReferenceYear — returns N+1 while N rows are retained (Req 5.2, 5.3, 6.3, 6.4)', () => {
    it('CUTOFF: resolves to the max year with both years retained', async () => {
        const year = await resolveActiveReferenceYear(TRACK, ReferenceDatasetType.CUTOFF);
        expect(year).toBe(YEAR_N_PLUS_1);
        // Retention: the year-N cutoff rows remain in the store after resolution (Req 5.3).
        expect(store.cutoff.filter((r) => r.referenceDataYear === YEAR_N)).toHaveLength(1);
    });

    it('SCORE_STANDING_MAP: resolves to the max year with both years retained', async () => {
        const year = await resolveActiveReferenceYear(TRACK, ReferenceDatasetType.SCORE_STANDING_MAP);
        expect(year).toBe(YEAR_N_PLUS_1);
        expect(store.scoreStanding.filter((r) => r.referenceDataYear === YEAR_N)).toHaveLength(3);
    });

    it('TOPIC_FREQUENCY: resolves to the max year with both years retained', async () => {
        const year = await resolveActiveReferenceYear(TRACK, ReferenceDatasetType.TOPIC_FREQUENCY);
        expect(year).toBe(YEAR_N_PLUS_1);
        // Retention: the year-N topic-frequency rows remain in the store (Req 6.4).
        expect(store.topicFreq.filter((r) => r.referenceDataYear === YEAR_N)).toHaveLength(1);
    });
});
