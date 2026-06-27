/**
 * Score Trajectory Service handler (task 16.1; design "Score Trajectory endpoint", Req 2;
 * "Score-Data-Point normalization & trajectory assembly"; Req 2.1, 13.1, 14.2).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/analytics/score-trajectory?from=&to=
 *     -> 200 { points: ScoreDataPoint[] }   scoped to the authenticated user (Req 2.1, 14.2)
 *     -> 422 VALIDATION_ERROR (from/to not a valid date, or from > to)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 read-service convention (see
 * `dashboardService.ts`, `focusSessionListService.ts`): it loads the authenticated user's
 * persisted Phase 1 attempt rows and additive `ExternalMockScore` rows — every query scoped
 * by `auth.user.id` so the output is computed using only data owned by the requesting user
 * (Req 14.2) — maps each onto the database-free row shapes consumed by the pure
 * {@link assembleScoreTrajectory}, and delegates ALL normalization, filtering, and ordering
 * to that module (design layering: route → thin service → pure module). It performs no
 * writes against Phase 1 models, reading them unaltered (Req 13.1).
 *
 * The route file (task 26.2) wraps this with `withAuth`, which rejects unauthenticated
 * requests with 401 UNAUTHORIZED before the handler runs (Req 14.1).
 *
 * The optional inclusive `from`/`to` ISO-date query params (Req 2.4) are parsed into a
 * {@link DateRange}; an omitted/blank bound leaves that side open, and `from > to` is a 422.
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import {
    assembleScoreTrajectory,
    type AttemptRow,
    type DateRange,
    type MockScoreRow,
} from './trajectory';

/** Discriminated result of {@link parseScoreTrajectoryRange}. */
export type ScoreTrajectoryRangeParse =
    | { ok: true; range: DateRange }
    | { ok: false; response: Response };

/**
 * Parse an optional date query param (inclusive ISO date-time string or epoch-millis string)
 * into a `Date`. Returns `undefined` when the param is absent/blank (meaning "no bound") and
 * `'invalid'` when present but unparseable, so the caller can distinguish "omitted" from
 * "provided but wrong".
 */
function parseOptionalDate(raw: string | null): Date | undefined | 'invalid' {
    if (raw === null || raw.trim() === '') {
        return undefined;
    }
    const trimmed = raw.trim();
    // Accept a bare epoch-millis integer as well as ISO date strings.
    const candidate = /^[+-]?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed;
    const date = new Date(candidate);
    return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

/**
 * Parse and validate the optional `from`/`to` range query params (Req 2.4).
 *
 * Rules:
 *   - Each of `from`/`to`, when present, must be a valid date (else 422).
 *   - When both are present, `from` must be less than or equal to `to` (else 422).
 *   - When omitted, the corresponding bound is left open.
 *
 * Pure: performs no I/O. Accepts a `URL` so it can be unit-tested by constructing request
 * URLs directly.
 */
export function parseScoreTrajectoryRange(url: URL): ScoreTrajectoryRangeParse {
    const from = parseOptionalDate(url.searchParams.get('from'));
    if (from === 'invalid') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "from" must be a valid date.',
                { param: 'from' },
            ),
        };
    }

    const to = parseOptionalDate(url.searchParams.get('to'));
    if (to === 'invalid') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "to" must be a valid date.',
                { param: 'to' },
            ),
        };
    }

    if (from !== undefined && to !== undefined && from.getTime() > to.getTime()) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "from" must not be later than "to".',
                { param: 'from', from: from.toISOString(), to: to.toISOString() },
            ),
        };
    }

    return { ok: true, range: { from, to } };
}

/**
 * Coerce a persisted Prisma `Json` `perQuestion` value into the array shape the pure module
 * consumes (only its `.length` — the count of scored questions — is read). A non-array Json
 * value degrades to an empty array so the derived `max` is `0` rather than throwing.
 */
function asPerQuestionArray(perQuestion: unknown): ReadonlyArray<unknown> {
    return Array.isArray(perQuestion) ? perQuestion : [];
}

/**
 * GET /api/analytics/score-trajectory?from=&to=
 *
 * Loads the authenticated user's `ExternalMockScore`, `PYQAttempt`, and `TimedPaperAttempt`
 * rows (scoped to `auth.user.id`), maps them onto the pure module's row shapes, and returns
 * the assembled, normalized, date-ordered series as `200 { points }`. Expects an
 * authenticated {@link AuthContext}; the route file wraps this with `withAuth` so
 * unauthenticated requests are rejected upstream (Req 14.1).
 */
export async function getScoreTrajectoryHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const url = new URL(request.url);

    const parsed = parseScoreTrajectoryRange(url);
    if (!parsed.ok) {
        return parsed.response;
    }

    const userId = auth.user.id;

    const [mockScoreRows, pyqAttemptRows, timedAttemptRows] = await Promise.all([
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

    const mockScores: MockScoreRow[] = mockScoreRows.map((row) => ({
        testDate: row.testDate,
        obtainedScore: row.obtainedScore,
        maxScore: row.maxScore,
    }));

    const pyqAttempts: AttemptRow[] = pyqAttemptRows.map((row) => ({
        createdAt: row.createdAt,
        totalScore: row.totalScore,
        perQuestion: asPerQuestionArray(row.perQuestion),
    }));

    const timedAttempts: AttemptRow[] = timedAttemptRows.map((row) => ({
        createdAt: row.createdAt,
        totalScore: row.totalScore,
        perQuestion: asPerQuestionArray(row.perQuestion),
    }));

    const points = assembleScoreTrajectory(mockScores, pyqAttempts, timedAttempts, parsed.range);

    return Response.json({ points });
}
