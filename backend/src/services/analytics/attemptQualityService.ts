/**
 * Attempt Quality service handler (task 21.1; design "Attempt Quality endpoint (Req 9)";
 * Req 9.1, 9.5, 14.2, 14.3).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/analytics/attempts/:attemptId/quality?type=PYQ|TIMED
 *     -> 200 AttemptQuality                  ({ accuracyPercent, averageTimePerQuestion,
 *                                              unattemptedCount, attemptRate })
 *     -> 422 VALIDATION_ERROR                 (missing/invalid `type` query param)
 *     -> 404 NOT_FOUND                        (no attempt for (type, attemptId), or owned by
 *                                              another user — existence is not leaked)
 *     -> 403 FORBIDDEN                        (cross-user reference — Req 14.3)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 layering convention (see
 * {@link ../pyq/pyqAttemptService} and {@link ./rankPredictionService}):
 *   1. Parse the `type` query param, which selects the source table — `PYQ` ->
 *      `PYQAttempt`, `TIMED` -> `TimedPaperAttempt`. A missing/invalid value is a
 *      `422 VALIDATION_ERROR` (Req 9.1 scopes the metric to those two attempt kinds).
 *   2. Load the attempt by `(type, attemptId)`; a missing attempt is `404 NOT_FOUND`.
 *   3. `assertOwnership(attempt.userId, ctx.user.id)` before reading the row, yielding
 *      `403 FORBIDDEN` on a cross-user reference (Req 14.2, 14.3). The route file wraps this
 *      with `withAuth`, so a tokenless request is rejected `401 UNAUTHORIZED` upstream.
 *   4. Map the persisted `perQuestion` JSON to the DB-free `AttemptQuestionOutcome[]` and
 *      delegate the math to the pure {@link computeAttemptQuality}. The total time is passed
 *      ONLY for a TIMED attempt; a PYQ attempt records no time, so its
 *      `averageTimePerQuestion` is reported as `null`/unavailable (Req 9.4).
 *
 * All math lives in the database-free pure module ({@link ./attemptQuality}); this handler
 * only orchestrates the read, per-user scoping, and serialization. It performs no write, so
 * the stored attempt is never modified (Req 9.5).
 */
import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import type { AttemptQuestionOutcome } from './attemptQuality';
import { computeAttemptQuality } from './attemptQuality';

/** The two attempt kinds whose quality this endpoint computes (Req 9.1). */
const ATTEMPT_TYPES = ['PYQ', 'TIMED'] as const;
type AttemptType = (typeof ATTEMPT_TYPES)[number];

/** Narrow an arbitrary query value to a supported `AttemptType`, or `null` when invalid. */
function parseAttemptType(value: string | null): AttemptType | null {
    return (ATTEMPT_TYPES as ReadonlyArray<string>).includes(value ?? '')
        ? (value as AttemptType)
        : null;
}

/**
 * Coerce a persisted `perQuestion` JSON value to the DB-free `AttemptQuestionOutcome[]`
 * shape the pure module consumes. Each stored entry carries (at least) `{ questionId,
 * outcome }` (see `lib/scoring/score.ts` `PerQuestionResult`); only those two fields are
 * read here. A non-array value degrades safely to an empty list.
 */
function toAttemptOutcomes(value: unknown): AttemptQuestionOutcome[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        return {
            questionId: String(record.questionId ?? ''),
            outcome: record.outcome as AttemptQuestionOutcome['outcome'],
        };
    });
}

/** The loaded shape needed to compute quality: ownership, outcomes, and optional time. */
interface LoadedAttempt {
    userId: string;
    perQuestion: unknown;
    /** Total time taken in seconds; only a TIMED attempt records this (Req 9.4). */
    timeTakenSec: number | null;
}

/**
 * Load the referenced attempt from the table chosen by `type`, returning `null` when no
 * such row exists. A PYQ attempt has no recorded time, so its `timeTakenSec` is reported as
 * `null` (Req 9.4); a TIMED attempt carries its persisted `timeTakenSec`.
 */
async function loadAttempt(
    type: AttemptType,
    attemptId: string,
): Promise<LoadedAttempt | null> {
    if (type === 'PYQ') {
        const attempt = await prisma.pYQAttempt.findUnique({
            where: { id: attemptId },
            select: { userId: true, perQuestion: true },
        });
        return attempt
            ? { userId: attempt.userId, perQuestion: attempt.perQuestion, timeTakenSec: null }
            : null;
    }

    const attempt = await prisma.timedPaperAttempt.findUnique({
        where: { id: attemptId },
        select: { userId: true, perQuestion: true, timeTakenSec: true },
    });
    return attempt
        ? {
            userId: attempt.userId,
            perQuestion: attempt.perQuestion,
            timeTakenSec: attempt.timeTakenSec,
        }
        : null;
}

/** Framework route context for the dynamic `/:attemptId` segment. */
export interface AttemptQualityRouteContext {
    params: { attemptId: string };
}

/**
 * Handle `GET /api/analytics/attempts/:attemptId/quality?type=PYQ|TIMED`. Computes one
 * attempt's quality metrics from its persisted per-question outcomes without modifying the
 * stored row (Req 9.1, 9.5), enforcing per-user ownership (Req 14.2, 14.3).
 */
export async function getAttemptQualityHandler(
    request: Request,
    auth: AuthContext,
    routeContext: AttemptQualityRouteContext,
): Promise<Response> {
    const { attemptId } = routeContext.params;
    if (typeof attemptId !== 'string' || attemptId.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'An attempt id is required.', {
            field: 'attemptId',
        });
    }

    // 1. The `type` query param selects the source table (PYQ vs TIMED).
    const type = parseAttemptType(new URL(request.url).searchParams.get('type'));
    if (type === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'A `type` query parameter of PYQ or TIMED is required.',
            { field: 'type' },
        );
    }

    // 2. Load the attempt by (type, attemptId); missing -> 404.
    const attempt = await loadAttempt(type, attemptId);
    if (!attempt) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Attempt not found.');
    }

    // 3. Enforce per-user ownership -> 403 on a cross-user reference (Req 14.3).
    assertOwnership(attempt.userId, auth.user.id);

    // 4. Delegate the math to the pure module. Time is passed ONLY for a TIMED attempt; a
    //    PYQ attempt records no time, so averageTimePerQuestion is null (Req 9.4).
    const quality = computeAttemptQuality(
        toAttemptOutcomes(attempt.perQuestion),
        attempt.timeTakenSec,
    );

    return Response.json(quality);
}
