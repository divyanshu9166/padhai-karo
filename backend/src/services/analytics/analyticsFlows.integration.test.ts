import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Endpoint integration tests for the Performance Analytics service handlers (task 28.1;
 * design "Testing Strategy → Integration tests"; Req 13.1).
 *
 * These drive every analytics service handler end-to-end against a mocked Prisma client
 * backed by a tiny in-memory store seeded with REPRESENTATIVE PHASE 1 ROWS — exactly the
 * persisted signals the Analytics_Service treats as its primary input (Req 13.1): PYQ and
 * timed-paper attempts with per-question outcomes (the timed attempt also carrying its
 * `timeTakenSec`), a categorized mistake-journal entry, focus sessions tagged with a
 * Session_Type, the `PYQ` questions and a `Profile` with `examTrack`, plus the additive
 * analytics reference rows (`CutoffReferenceData` / `ScoreStandingMap` /
 * `TopicFrequencyReferenceData` / `QuestionTopicMap`) and the `Subject` / `Chapter` rows the
 * weak-area joins resolve names through.
 *
 * The suite is DB/network-independent and deterministic, mirroring the repo's mocked-Prisma
 * integration convention (see `services/ai/aiFlows.integration.test.ts` and
 * `services/subscription/billingFlows.integration.test.ts`). Each handler is invoked with a
 * fake {@link AuthContext} + `Request` and asserted to return its documented payload computed
 * from the seeded Phase 1 rows — confirming Phase 1 data is the primary analytics input
 * (Req 13.1). The covered surfaces:
 *
 *   - External Mock Score CRUD (create / list / edit / delete)
 *   - Score Trajectory
 *   - Rank Prediction
 *   - Target-Cutoff listing + selection, and Score Gap
 *   - Topic Trends
 *   - Topic Priority
 *   - Attempt Quality (PYQ + TIMED)
 *   - Attempt Quality Trend
 *   - Weak Areas
 *
 * Validates: Requirements 13.1
 */

import { getCutoffEntries, getScoreStandingBands } from '@/lib/analytics/cutoffCatalog';

// --- Prisma mock: a tiny in-memory store with `where`-aware query helpers ----
//
// The store arrays are (re)seeded in `beforeEach`. Each mocked method honors the subset of
// the `where` clause the real handlers pass: equality (userId / id / examTrack /
// referenceDataYear / questionId / referenceKey), `{ in: [...] }` membership, and
// `{ gte, lte }` ranges on `createdAt`. `aggregate` resolves the active reference year as the
// MAX `referenceDataYear` among matching rows (mirroring `resolveActiveReferenceYear`).
const { db } = vi.hoisted(() => ({
    db: {
        seq: 0,
        profiles: [] as Array<Record<string, unknown>>,
        externalMockScores: [] as Array<Record<string, unknown>>,
        pyqAttempts: [] as Array<Record<string, unknown>>,
        timedAttempts: [] as Array<Record<string, unknown>>,
        mistakes: [] as Array<Record<string, unknown>>,
        focusSessions: [] as Array<Record<string, unknown>>,
        pyqs: [] as Array<Record<string, unknown>>,
        questionTopicMaps: [] as Array<Record<string, unknown>>,
        subjects: [] as Array<Record<string, unknown>>,
        chapters: [] as Array<Record<string, unknown>>,
        cutoffs: [] as Array<Record<string, unknown>>,
        scoreStandings: [] as Array<Record<string, unknown>>,
        topicFreqs: [] as Array<Record<string, unknown>>,
        targetSelections: [] as Array<Record<string, unknown>>,
    },
}));

vi.mock('@/lib/db', () => {
    type Row = Record<string, unknown>;
    type Where = Record<string, unknown> | undefined;

    const toMillis = (value: unknown): number =>
        value instanceof Date ? value.getTime() : (value as number);

    const matchWhere = (row: Row, where: Where): boolean => {
        if (!where) return true;
        for (const [key, cond] of Object.entries(where)) {
            if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
                const c = cond as Record<string, unknown>;
                if ('in' in c) {
                    if (!(c.in as unknown[]).includes(row[key])) return false;
                    continue;
                }
                if ('gte' in c || 'lte' in c) {
                    const t = toMillis(row[key]);
                    if ('gte' in c && t < toMillis(c.gte)) return false;
                    if ('lte' in c && t > toMillis(c.lte)) return false;
                    continue;
                }
            }
            if (row[key] !== cond) return false;
        }
        return true;
    };

    const findMany = (rows: Row[]) =>
        vi.fn(async ({ where }: { where?: Where } = {}) =>
            rows.filter((r) => matchWhere(r, where)).map((r) => ({ ...r })),
        );

    const findUnique = (rows: Row[]) =>
        vi.fn(async ({ where }: { where: Where }) => {
            const found = rows.find((r) => matchWhere(r, where));
            return found ? { ...found } : null;
        });

    const create = (rows: Row[]) =>
        vi.fn(async ({ data }: { data: Row }) => {
            const row: Row = {
                id: `id-${++db.seq}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
            };
            rows.push(row);
            return { ...row };
        });

    const update = (rows: Row[]) =>
        vi.fn(async ({ where, data }: { where: Where; data: Row }) => {
            const row = rows.find((r) => matchWhere(r, where));
            if (!row) throw new Error('row not found');
            Object.assign(row, data, { updatedAt: new Date() });
            return { ...row };
        });

    const del = (rows: Row[]) =>
        vi.fn(async ({ where }: { where: Where }) => {
            const idx = rows.findIndex((r) => matchWhere(r, where));
            if (idx === -1) throw new Error('row not found');
            const [removed] = rows.splice(idx, 1);
            return { ...removed };
        });

    const upsert = (rows: Row[]) =>
        vi.fn(async ({ where, create: createData, update: updateData }: {
            where: Where;
            create: Row;
            update: Row;
        }) => {
            const existing = rows.find((r) => matchWhere(r, where));
            if (existing) {
                Object.assign(existing, updateData, { updatedAt: new Date() });
                return { ...existing };
            }
            const row: Row = {
                id: `id-${++db.seq}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...createData,
            };
            rows.push(row);
            return { ...row };
        });

    const aggregateMaxYear = (rows: Row[]) =>
        vi.fn(async ({ where }: { where: Where }) => {
            const matched = rows.filter((r) => matchWhere(r, where));
            const referenceDataYear =
                matched.length === 0
                    ? null
                    : Math.max(...matched.map((r) => r.referenceDataYear as number));
            return { _max: { referenceDataYear } };
        });

    const prisma = {
        profile: { findUnique: findUnique(db.profiles) },
        externalMockScore: {
            create: create(db.externalMockScores),
            findMany: findMany(db.externalMockScores),
            findUnique: findUnique(db.externalMockScores),
            update: update(db.externalMockScores),
            delete: del(db.externalMockScores),
        },
        pYQAttempt: {
            findMany: findMany(db.pyqAttempts),
            findUnique: findUnique(db.pyqAttempts),
        },
        timedPaperAttempt: {
            findMany: findMany(db.timedAttempts),
            findUnique: findUnique(db.timedAttempts),
        },
        mistakeJournalEntry: { findMany: findMany(db.mistakes) },
        focusSession: { findMany: findMany(db.focusSessions) },
        pYQ: { findMany: findMany(db.pyqs) },
        questionTopicMap: { findMany: findMany(db.questionTopicMaps) },
        subject: { findMany: findMany(db.subjects) },
        chapter: { findMany: findMany(db.chapters) },
        cutoffReferenceData: {
            aggregate: aggregateMaxYear(db.cutoffs),
            findMany: findMany(db.cutoffs),
            findUnique: findUnique(db.cutoffs),
        },
        scoreStandingMap: {
            aggregate: aggregateMaxYear(db.scoreStandings),
            findMany: findMany(db.scoreStandings),
        },
        topicFrequencyReferenceData: {
            aggregate: aggregateMaxYear(db.topicFreqs),
            findMany: findMany(db.topicFreqs),
        },
        targetCollegeCutoffSelection: {
            findUnique: findUnique(db.targetSelections),
            upsert: upsert(db.targetSelections),
        },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';
import {
    createMockScoreHandler,
    deleteMockScoreHandler,
    editMockScoreHandler,
    listMockScoresHandler,
} from './mockScoreService';
import { getScoreTrajectoryHandler } from './scoreTrajectoryService';
import { getRankPredictionHandler } from './rankPredictionService';
import { getScoreGapHandler } from './scoreGapService';
import { getTargetCutoff, listCutoffs, setTargetCutoff } from './cutoffService';
import { topicTrendsHandler } from './topicTrendService';
import { topicPriorityHandler } from './topicPriorityService';
import { getAttemptQualityHandler } from './attemptQualityService';
import { getAttemptQualityTrendHandler } from './attemptQualityTrendService';
import { weakAreasHandler } from './weakAreaService';

const USER = 'user-1';
const TRACK = 'JEE';
const YEAR = 2024;
const BASE = 'http://localhost/api/analytics';

function authCtx(userId = USER): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function req(path: string, init?: RequestInit): Request {
    return new Request(`${BASE}${path}`, init);
}

function jsonReq(path: string, method: string, body: unknown): Request {
    return new Request(`${BASE}${path}`, {
        method,
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

/** Reset and reseed the in-memory store with a representative Phase 1 dataset for one user. */
function seed(): void {
    db.seq = 0;
    for (const value of Object.values(db)) {
        if (Array.isArray(value)) value.length = 0;
    }

    // Phase 1: profile (drives Exam_Track), subjects + per-user chapters (Topic == Chapter
    // referenceKey), and the PYQ questions + their additive topic mapping.
    db.profiles.push({ userId: USER, examTrack: TRACK });
    db.subjects.push(
        { id: 'subj-phy', name: 'Physics' },
        { id: 'subj-math', name: 'Mathematics' },
    );
    db.chapters.push(
        { userId: USER, referenceKey: 'JEE-PHY-MECHANICS', name: 'Mechanics' },
        { userId: USER, referenceKey: 'JEE-PHY-KINEMATICS', name: 'Kinematics' },
    );
    db.pyqs.push(
        { id: 'q1', subjectId: 'subj-phy' },
        { id: 'q2', subjectId: 'subj-phy' },
        { id: 'q3', subjectId: 'subj-math' },
    );
    // q3 has no QuestionTopicMap entry -> contributes only at Subject level.
    db.questionTopicMaps.push(
        { questionId: 'q1', topicKey: 'JEE-PHY-MECHANICS' },
        { questionId: 'q2', topicKey: 'JEE-PHY-KINEMATICS' },
    );

    // Phase 1: user-entered external mock scores (App_Derived + external feed the trajectory).
    db.externalMockScores.push(
        {
            id: 'm1',
            userId: USER,
            source: 'ALLEN',
            sourceName: null,
            testDate: new Date('2024-01-10T00:00:00.000Z'),
            obtainedScore: 200,
            maxScore: 300,
            createdAt: new Date('2024-01-10T00:00:00.000Z'),
        },
        {
            id: 'm2',
            userId: USER,
            source: 'AAKASH',
            sourceName: null,
            testDate: new Date('2024-02-10T00:00:00.000Z'),
            obtainedScore: 250,
            maxScore: 300,
            createdAt: new Date('2024-02-10T00:00:00.000Z'),
        },
    );

    // Phase 1: a PYQ attempt (no time recorded) and a timed-paper attempt (with time), each
    // with per-question outcomes.
    db.pyqAttempts.push({
        id: 'pyq-att-1',
        userId: USER,
        createdAt: new Date('2024-03-01T00:00:00.000Z'),
        totalScore: 1,
        perQuestion: [
            { questionId: 'q1', outcome: 'INCORRECT' },
            { questionId: 'q2', outcome: 'CORRECT' },
            { questionId: 'q3', outcome: 'UNANSWERED' },
        ],
    });
    db.timedAttempts.push({
        id: 'timed-att-1',
        userId: USER,
        createdAt: new Date('2024-03-15T00:00:00.000Z'),
        totalScore: 2,
        timeTakenSec: 600,
        perQuestion: [
            { questionId: 'q1', outcome: 'CORRECT' },
            { questionId: 'q2', outcome: 'CORRECT' },
            { questionId: 'q3', outcome: 'INCORRECT' },
        ],
    });

    // Phase 1: a categorized mistake-journal entry and Session_Type-tagged focus sessions.
    db.mistakes.push({
        id: 'mis-1',
        userId: USER,
        questionId: 'q1',
        subjectId: 'subj-phy',
        category: 'CONCEPT_GAP',
    });
    db.focusSessions.push(
        { id: 'fs-1', userId: USER, sessionType: 'REVISION', focusedDurationMin: 30 },
        { id: 'fs-2', userId: USER, sessionType: 'PRACTICE_PROBLEMS', focusedDurationMin: 45 },
    );

    // Additive analytics reference rows (system-supplied, year-versioned), drawn from the
    // seed catalogs so the integration data matches the shipped reference dataset.
    getCutoffEntries(TRACK, YEAR).forEach((entry, i) =>
        db.cutoffs.push({ id: `cut-${i}`, examTrack: TRACK, referenceDataYear: YEAR, ...entry }),
    );
    getScoreStandingBands(TRACK, YEAR).forEach((band, i) =>
        db.scoreStandings.push({
            id: `ssm-${i}`,
            examTrack: TRACK,
            referenceDataYear: YEAR,
            ...band,
        }),
    );
    db.topicFreqs.push(
        {
            id: 'tf-1',
            examTrack: TRACK,
            referenceDataYear: YEAR,
            topicKey: 'JEE-PHY-MECHANICS',
            topicName: 'Mechanics',
            subjectKey: 'JEE-PHYSICS',
            appearanceCount: 40,
            yearSpanStart: 2014,
            yearSpanEnd: 2023,
            avgQuestionsPerYear: 4,
        },
        {
            id: 'tf-2',
            examTrack: TRACK,
            referenceDataYear: YEAR,
            topicKey: 'JEE-PHY-KINEMATICS',
            topicName: 'Kinematics',
            subjectKey: 'JEE-PHYSICS',
            appearanceCount: 30,
            yearSpanStart: 2014,
            yearSpanEnd: 2023,
            avgQuestionsPerYear: 3,
        },
    );
}

beforeEach(() => {
    seed();
});

describe('Analytics integration — External Mock Score CRUD (Req 1, 13.1)', () => {
    it('creates, lists, edits, and deletes a mock score end-to-end', async () => {
        const pastDate = new Date('2024-02-20T00:00:00.000Z').toISOString();

        // CREATE -> 201, persisted.
        const createRes = await createMockScoreHandler(
            jsonReq('/mock-scores', 'POST', {
                source: 'ALLEN',
                testDate: pastDate,
                obtainedScore: 180,
                maxScore: 300,
            }),
            authCtx(),
        );
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as { mockScore: { id: string; obtainedScore: number } };
        expect(created.mockScore.id).toBeTruthy();
        expect(db.externalMockScores).toHaveLength(3);

        // LIST -> 200 returns all three of the user's scores (m1, m2, created).
        const listRes = await listMockScoresHandler(req('/mock-scores'), authCtx());
        expect(listRes.status).toBe(200);
        const listed = (await listRes.json()) as { mockScores: Array<{ id: string }> };
        expect(listed.mockScores).toHaveLength(3);

        // EDIT (PATCH) the created score -> 200, change persisted (re-validated merged record).
        const editRes = await editMockScoreHandler(
            jsonReq(`/mock-scores/${created.mockScore.id}`, 'PATCH', { obtainedScore: 210 }),
            authCtx(),
            { params: { id: created.mockScore.id } },
        );
        expect(editRes.status).toBe(200);
        const edited = (await editRes.json()) as { mockScore: { obtainedScore: number } };
        expect(edited.mockScore.obtainedScore).toBe(210);

        // DELETE -> 204, removed.
        const deleteRes = await deleteMockScoreHandler(
            req(`/mock-scores/${created.mockScore.id}`, { method: 'DELETE' }),
            authCtx(),
            { params: { id: created.mockScore.id } },
        );
        expect(deleteRes.status).toBe(204);
        expect(db.externalMockScores).toHaveLength(2);
    });
});

describe('Analytics integration — Score Trajectory (Req 2, 13.1)', () => {
    it('assembles a normalized, date-ordered series from external + app-derived scores', async () => {
        const res = await getScoreTrajectoryHandler(req('/score-trajectory'), authCtx());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            points: Array<{ date: string; source: string; normalizedPercent: number }>;
        };

        // 2 external mock scores + 1 PYQ attempt + 1 timed attempt = 4 points.
        expect(body.points).toHaveLength(4);

        // Sources are labeled and all three kinds appear.
        const sources = new Set(body.points.map((p) => p.source));
        expect(sources).toEqual(
            new Set(['EXTERNAL_MOCK', 'PYQ_ATTEMPT', 'TIMED_PAPER_ATTEMPT']),
        );

        // Points are sorted ascending by date.
        const times = body.points.map((p) => new Date(p.date).getTime());
        expect(times).toEqual([...times].sort((a, b) => a - b));
    });
});

describe('Analytics integration — Rank Prediction (Req 3, 5, 13.1)', () => {
    it('maps recent points to a percentile band using the active standing map', async () => {
        const res = await getRankPredictionHandler(req('/rank-prediction'), authCtx());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            kind: string;
            track: string;
            estimate: { low: number; high: number; unit: string };
            referenceDataYear: number;
        };

        expect(body.kind).toBe('OK');
        expect(body.track).toBe(TRACK);
        expect(body.estimate.unit).toBe('PERCENTILE');
        expect(body.estimate.high).toBeGreaterThanOrEqual(body.estimate.low);
        expect(body.referenceDataYear).toBe(YEAR);
    });
});

describe('Analytics integration — Cutoff selection + Score Gap (Req 4, 5, 13.1)', () => {
    it('lists cutoffs, persists a selection, and computes the score gap', async () => {
        // LIST cutoffs from the active dataset.
        const cutoffsRes = await listCutoffs(req('/cutoffs'), authCtx());
        expect(cutoffsRes.status).toBe(200);
        const cutoffsBody = (await cutoffsRes.json()) as {
            referenceDataYear: number;
            cutoffs: Array<{ id: string }>;
        };
        expect(cutoffsBody.referenceDataYear).toBe(YEAR);
        expect(cutoffsBody.cutoffs.length).toBeGreaterThan(0);

        const targetId = cutoffsBody.cutoffs[0].id;

        // SELECT (PUT) a target cutoff -> 200, persisted.
        const putRes = await setTargetCutoff(
            jsonReq('/target-cutoff', 'PUT', { cutoffReferenceId: targetId }),
            authCtx(),
        );
        expect(putRes.status).toBe(200);
        const putBody = (await putRes.json()) as { selection: { cutoffReferenceId: string } };
        expect(putBody.selection.cutoffReferenceId).toBe(targetId);

        // GET the selection back.
        const getRes = await getTargetCutoff(req('/target-cutoff'), authCtx());
        const getBody = (await getRes.json()) as { selection: { cutoffReferenceId: string } | null };
        expect(getBody.selection?.cutoffReferenceId).toBe(targetId);

        // SCORE GAP -> 200 with a discriminated result carrying the cutoff reference year.
        const gapRes = await getScoreGapHandler(req('/score-gap'), authCtx());
        expect(gapRes.status).toBe(200);
        const gapBody = (await gapRes.json()) as { kind: string; referenceDataYear?: number };
        expect(['GAP', 'MET', 'INSUFFICIENT_DATA']).toContain(gapBody.kind);
        expect(gapBody.referenceDataYear).toBe(YEAR);
    });
});

describe('Analytics integration — Topic Trends (Req 6, 7, 13.1)', () => {
    it('returns the track topic universe with frequency data, descending by avg questions/year', async () => {
        const res = await topicTrendsHandler(req('/topic-trends'), authCtx());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            referenceDataYear: number;
            topics: Array<{ topicKey: string; avgQuestionsPerYear: number; hasFrequencyData: boolean }>;
        };

        expect(body.referenceDataYear).toBe(YEAR);
        expect(body.topics.length).toBeGreaterThan(0);

        // Seeded topics carry frequency data.
        const mechanics = body.topics.find((t) => t.topicKey === 'JEE-PHY-MECHANICS');
        expect(mechanics?.hasFrequencyData).toBe(true);
        expect(mechanics?.avgQuestionsPerYear).toBe(4);

        // Ordered descending by avgQuestionsPerYear.
        const avgs = body.topics.map((t) => t.avgQuestionsPerYear);
        expect(avgs).toEqual([...avgs].sort((a, b) => b - a));
    });
});

describe('Analytics integration — Topic Priority (Req 8, 12, 13.1)', () => {
    it('combines frequency with the user weak-area score map into a priority ranking', async () => {
        const res = await topicPriorityHandler(req('/topic-priority'), authCtx());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            referenceDataYear: number;
            topics: Array<{ topicKey: string; priority: number; weakAreaScore: number }>;
        };

        expect(body.referenceDataYear).toBe(YEAR);
        expect(body.topics.length).toBeGreaterThan(0);
        // Ordered descending by priority.
        const priorities = body.topics.map((t) => t.priority);
        expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
    });
});

describe('Analytics integration — Attempt Quality (Req 9, 13.1)', () => {
    it('computes quality for a PYQ attempt (no time available)', async () => {
        const res = await getAttemptQualityHandler(
            req('/attempts/pyq-att-1/quality?type=PYQ'),
            authCtx(),
            { params: { attemptId: 'pyq-att-1' } },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            accuracyPercent: number;
            averageTimePerQuestion: number | null;
            unattemptedCount: number;
            attemptRate: number;
        };

        // perQuestion: INCORRECT, CORRECT, UNANSWERED -> attempted 2, correct 1.
        expect(body.accuracyPercent).toBe(50);
        expect(body.unattemptedCount).toBe(1);
        // A PYQ attempt records no time -> average time per question is unavailable (Req 9.4).
        expect(body.averageTimePerQuestion).toBeNull();
    });

    it('computes quality for a TIMED attempt (with average time per question)', async () => {
        const res = await getAttemptQualityHandler(
            req('/attempts/timed-att-1/quality?type=TIMED'),
            authCtx(),
            { params: { attemptId: 'timed-att-1' } },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            accuracyPercent: number;
            averageTimePerQuestion: number | null;
            unattemptedCount: number;
        };

        // perQuestion: CORRECT, CORRECT, INCORRECT -> attempted 3, correct 2.
        expect(body.accuracyPercent).toBeCloseTo((2 / 3) * 100, 5);
        expect(body.unattemptedCount).toBe(0);
        // timeTakenSec 600 / 3 questions = 200.
        expect(body.averageTimePerQuestion).toBe(200);
    });
});

describe('Analytics integration — Attempt Quality Trend (Req 10, 13.1)', () => {
    it('returns a date-ordered series with direction of change across the user attempts', async () => {
        const res = await getAttemptQualityTrendHandler(req('/attempt-quality-trend'), authCtx());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            kind: string;
            series?: Array<{ date: string }>;
            accuracyDirection?: string;
            attemptRateDirection?: string;
        };

        // Two in-range attempts (1 PYQ + 1 timed) -> a computed trend, not INSUFFICIENT_DATA.
        expect(body.kind).toBe('OK');
        expect(body.series).toHaveLength(2);
        expect(['INCREASED', 'DECREASED', 'UNCHANGED']).toContain(body.accuracyDirection);
    });
});

describe('Analytics integration — Weak Areas (Req 11, 12, 13.1)', () => {
    it('derives ranked weak areas and the session-type study-time distribution', async () => {
        const res = await weakAreasHandler(req('/weak-areas'), authCtx());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            weakAreas: Array<{ level: string; key: string; weakAreaScore: number }>;
            sessionTypeDistribution: Array<{ sessionType: string; totalMinutes: number }>;
        };

        // The user has incorrect outcomes + a mistake entry -> at least one weak area.
        expect(body.weakAreas.length).toBeGreaterThan(0);
        // Ranked descending by weakAreaScore.
        const scores = body.weakAreas.map((w) => w.weakAreaScore);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));

        // Session-type distribution surfaces the Phase 1 focus-session data (Req 11.3).
        const byType = new Map(
            body.sessionTypeDistribution.map((s) => [s.sessionType, s.totalMinutes]),
        );
        expect(byType.get('REVISION')).toBe(30);
        expect(byType.get('PRACTICE_PROBLEMS')).toBe(45);
    });
});
