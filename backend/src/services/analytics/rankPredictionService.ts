/**
 * Rank Prediction service handler (task 17.1; design "Rank Prediction endpoint (Req 3)" +
 * "Error Handling"; Req 3.1, 3.2, 3.5, 5.2, 5.4, 14.2).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/analytics/rank-prediction
 *     -> 200 RankPredictionResult            (discriminated payload, see below)
 *     -> 503 REFERENCE_DATA_UNAVAILABLE       (no ScoreStandingMap for the user's track — Req 5.4)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 layering convention (see
 * {@link ../dashboard/dashboardService} and {@link ./mockScoreService}):
 *   1. Read the requesting user's `Profile.examTrack` (the Exam_Track drives both the
 *      reference-dataset selection and the PERCENTILE/MARKS unit — Req 3.1, 3.2).
 *   2. Resolve the active `ScoreStandingMap` version — the most-recent `referenceDataYear`
 *      for the track (Req 5.2) — via the shared {@link resolveActiveReferenceYear}. When no
 *      rows exist for the track, return `503 REFERENCE_DATA_UNAVAILABLE` (Req 5.4).
 *   3. Load that year's `ScoreStandingMap` bands for the track.
 *   4. Build the user's normalized Score_Data_Points by reusing the pure trajectory
 *      assembly over the user's External_Mock_Scores, PYQ_Attempts, and Timed_Paper_Attempts
 *      — every query scoped by `ctx.user.id` (per-user isolation, Req 14.2).
 *   5. Delegate the mapping to the pure {@link predictRank}, which returns the discriminated
 *      `RankPredictionResult` and echoes the `referenceDataYear` used (Req 3.5).
 *
 * All math lives in the database-free pure modules ({@link ../analytics/trajectory} and
 * {@link ../analytics/rankPrediction}); this handler only orchestrates I/O, per-user
 * scoping, and serialization. The route file wraps it with `withAuth`, so unauthenticated
 * requests are rejected with `401 UNAUTHORIZED` before the handler runs (Req 14.1).
 *
 * Response payload (HTTP 200, discriminated by `kind`):
 *   - { kind: 'OK', track, estimate: { low, high, unit }, referenceDataYear }   (Req 3.1–3.3, 3.5)
 *   - { kind: 'INSUFFICIENT_DATA', minimumRequired }                            (Req 3.4)
 */
import { ReferenceDatasetType } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import type { CutoffUnit, ScoreStandingBand } from '../../lib/analytics/cutoffCatalog';
import { resolveActiveReferenceYear } from '../../lib/analytics/referenceVersion';
import type { ExamTrack } from '../../lib/reference';
import { predictRank, type RankPredictionResult } from './rankPrediction';
import { assembleScoreTrajectory, type AttemptRow } from './trajectory';

/**
 * Coerce a persisted `perQuestion` JSON value to a plain array. Only its length is consumed
 * by the trajectory assembly (the App_Derived_Score's maximum is the scored-question
 * count), so a non-array value degrades safely to an empty list.
 */
function toPerQuestionArray(value: unknown): AttemptRow['perQuestion'] {
    return Array.isArray(value) ? value : [];
}

/**
 * Outcome of {@link computeUserRankPrediction}: a reusable, handler-agnostic computation
 * of a user's current Rank_Prediction that other analytics handlers (notably the
 * Score-Gap handler — task 18.2) can share without duplicating the
 * profile → standing-map → trajectory → predict pipeline.
 *
 *   - `REFERENCE_UNAVAILABLE` — the user has no profile, or no active `ScoreStandingMap`
 *     exists for their Exam_Track; callers translate this into a
 *     `503 REFERENCE_DATA_UNAVAILABLE` response (Req 5.4).
 *   - `COMPUTED` — the user's Exam_Track plus the pure `RankPredictionResult` (either an
 *     `OK` standing band or `INSUFFICIENT_DATA`).
 */
export type UserRankPredictionOutcome =
    | { kind: 'REFERENCE_UNAVAILABLE' }
    | { kind: 'COMPUTED'; track: ExamTrack; result: RankPredictionResult };

/**
 * Compute the authenticated user's current Rank_Prediction by orchestrating the same
 * pipeline the rank-prediction endpoint uses (Req 3.1–3.5, 5.2, 5.4, 14.2):
 *
 *   1. Read the user's `Profile.examTrack` (selects the dataset + PERCENTILE/MARKS unit).
 *   2. Resolve the active (most-recent) `ScoreStandingMap` year for the track (Req 5.2).
 *   3. Load that year's standing bands.
 *   4. Build the user's normalized Score_Data_Points from their External_Mock_Scores,
 *      PYQ_Attempts, and Timed_Paper_Attempts — every query scoped by `userId` (Req 14.2).
 *   5. Delegate the mapping to the pure {@link predictRank}.
 *
 * Returns `REFERENCE_UNAVAILABLE` when no profile or no standing data exists (so callers
 * emit `503 REFERENCE_DATA_UNAVAILABLE`); otherwise `COMPUTED` with the track and the pure
 * `RankPredictionResult`. Performs only reads — never mutates a Phase 1 row.
 *
 * @param userId The requesting user's id; all queries are scoped to it (per-user isolation).
 */
export async function computeUserRankPrediction(
    userId: string,
): Promise<UserRankPredictionOutcome> {
    // 1. Exam_Track from the user's profile — selects the reference dataset and the unit.
    const profile = await prisma.profile.findUnique({
        where: { userId },
        select: { examTrack: true },
    });

    if (!profile) {
        return { kind: 'REFERENCE_UNAVAILABLE' };
    }

    const examTrack = profile.examTrack as ExamTrack;

    // 2. Active (most-recent) ScoreStandingMap year for the track (Req 5.2); none -> unavailable.
    const referenceDataYear = await resolveActiveReferenceYear(
        examTrack,
        ReferenceDatasetType.SCORE_STANDING_MAP,
    );

    if (referenceDataYear === null) {
        return { kind: 'REFERENCE_UNAVAILABLE' };
    }

    // 3. Load the active year's standing bands for the track.
    const bandRows = await prisma.scoreStandingMap.findMany({
        where: { examTrack, referenceDataYear },
        select: {
            minScorePercent: true,
            maxScorePercent: true,
            estimateLow: true,
            estimateHigh: true,
            unit: true,
        },
    });

    if (bandRows.length === 0) {
        // Defensive: the resolver found a year but no rows materialized.
        return { kind: 'REFERENCE_UNAVAILABLE' };
    }

    const bands: ScoreStandingBand[] = bandRows.map((row) => ({
        minScorePercent: row.minScorePercent,
        maxScorePercent: row.maxScorePercent,
        estimateLow: row.estimateLow,
        estimateHigh: row.estimateHigh,
        unit: row.unit as CutoffUnit,
    }));

    // 4. Build the user's recent normalized score points (per-user scoped — Req 14.2).
    const [mockScores, pyqAttempts, timedAttempts] = await Promise.all([
        prisma.externalMockScore.findMany({
            where: { userId },
            select: { testDate: true, obtainedScore: true, maxScore: true },
        }),
        prisma.pYQAttempt.findMany({
            where: { userId },
            select: { createdAt: true, totalScore: true, perQuestion: true },
        }),
        prisma.timedPaperAttempt.findMany({
            where: { userId },
            select: { createdAt: true, totalScore: true, perQuestion: true },
        }),
    ]);

    const points = assembleScoreTrajectory(
        mockScores,
        pyqAttempts.map((row) => ({
            createdAt: row.createdAt,
            totalScore: row.totalScore,
            perQuestion: toPerQuestionArray(row.perQuestion),
        })),
        timedAttempts.map((row) => ({
            createdAt: row.createdAt,
            totalScore: row.totalScore,
            perQuestion: toPerQuestionArray(row.perQuestion),
        })),
    );

    // 5. Delegate the mapping to the pure module (Req 3.1–3.5).
    const result = predictRank(points, bands, referenceDataYear);

    return { kind: 'COMPUTED', track: examTrack, result };
}

/**
 * Handle `GET /api/analytics/rank-prediction`. Maps the user's recent normalized score
 * points to an estimated standing band using the active `ScoreStandingMap` for their
 * Exam_Track, always returning a band and surfacing insufficient-data /
 * reference-unavailable states (Req 3.1–3.5, 5.2, 5.4, 14.2).
 */
export async function getRankPredictionHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const outcome = await computeUserRankPrediction(auth.user.id);

    if (outcome.kind === 'REFERENCE_UNAVAILABLE') {
        return errorResponse(
            503,
            ErrorCode.REFERENCE_DATA_UNAVAILABLE,
            'No score-standing reference data is available for your exam track.',
        );
    }

    const { track, result } = outcome;

    if (result.kind === 'OK') {
        return Response.json({
            kind: 'OK',
            track,
            estimate: result.estimate,
            referenceDataYear: result.referenceDataYear,
        });
    }

    return Response.json({
        kind: 'INSUFFICIENT_DATA',
        minimumRequired: result.minimumRequired,
    });
}
