/**
 * Attempt Quality Trend Service handler (task 22.1; design "Attempt Quality Trend endpoint",
 * Req 10; "Attempt quality trend & direction"; Req 10.1, 10.2, 10.4, 14.2).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/analytics/attempt-quality-trend?subjectId=&from=&to=
 *     -> 200 AttemptQualityTrendResult   scoped to the authenticated user (Req 10.1, 14.2)
 *     -> 422 VALIDATION_ERROR (from/to not a valid date, or from > to)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 / Phase 2 read-service convention
 * (see `scoreTrajectoryService.ts`, `dashboardService.ts`, `focusSessionListService.ts`): it
 * loads the authenticated user's persisted Phase 1 attempt rows — `PYQAttempt` and
 * `TimedPaperAttempt`, every query scoped by `auth.user.id` so the output is computed using
 * only data owned by the requesting user (Req 14.2) — resolves each question's
 * `PYQ.subjectId`, maps each attempt onto the database-free {@link AttemptQualityTrendInput}
 * shape consumed by the pure {@link computeAttemptQualityTrend}, and delegates ALL series
 * assembly, ordering, subject filtering, direction-of-change, and insufficient-data logic to
 * that module (design layering: route → thin service → pure module). It performs no writes
 * against Phase 1 models, reading them unaltered (Req 13.1).
 *
 * The returned `AttemptQualityTrendResult` is a payload DISTINCT from the Score Trajectory's
 * `{ points }` — a separate endpoint and response shape — satisfying the requirement that the
 * attempt-quality trend be reported separately from the content-knowledge metrics of the
 * score trajectory (Req 10.2).
 *
 * The route file (task 26.5) wraps this with `withAuth`, which rejects unauthenticated
 * requests with 401 UNAUTHORIZED before the handler runs (Req 14.1).
 *
 * Query params:
 *   - `subjectId` (optional) — restricts each attempt to that Subject's questions, dropping
 *     attempts with none for the subject; delegated to the pure module (Req 10.4).
 *   - `from`/`to` (optional, inclusive ISO dates) — bound the attempts by `createdAt`,
 *     applied at the Prisma query level; an omitted/blank bound leaves that side open, and
 *     `from > to` is a 422.
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { QuestionOutcome } from '../../lib/scoring/score';

import {
    computeAttemptQualityTrend,
    type AttemptQualityTrendInput,
    type TrendQuestionOutcome,
} from './attemptQualityTrend';

/** A validated, optional inclusive `[from, to]` bound on `createdAt`. */
export interface AttemptQualityTrendRange {
    from: Date | null;
    to: Date | null;
}

/** Discriminated result of {@link parseAttemptQualityTrendRange}. */
export type AttemptQualityTrendRangeParse =
    | { ok: true; range: AttemptQualityTrendRange }
    | { ok: false; response: Response };

/**
 * Parse an optional date query param (inclusive ISO date-time string or epoch-millis string)
 * into a `Date`. Returns `null` when the param is absent/blank (meaning "no bound") and
 * `'invalid'` when present but unparseable, so the caller can distinguish "omitted" from
 * "provided but wrong".
 */
function parseOptionalDate(raw: string | null): Date | null | 'invalid' {
    if (raw === null || raw.trim() === '') {
        return null;
    }
    const trimmed = raw.trim();
    // Accept a bare epoch-millis integer as well as ISO date strings.
    const candidate = /^[+-]?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed;
    const date = new Date(candidate);
    return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

/**
 * Parse and validate the optional `from`/`to` range query params bounding `createdAt`.
 *
 * Rules:
 *   - Each of `from`/`to`, when present, must be a valid date (else 422).
 *   - When both are present, `from` must be less than or equal to `to` (else 422).
 *   - When omitted, the corresponding bound is left open.
 *
 * Pure: performs no I/O. Accepts a `URL` so it can be unit-tested by constructing request
 * URLs directly.
 */
export function parseAttemptQualityTrendRange(url: URL): AttemptQualityTrendRangeParse {
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

    if (from !== null && to !== null && from.getTime() > to.getTime()) {
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
 * Read an optional `subjectId` query param, treating an absent/blank value as "no filter"
 * (`null`). The pure module applies the actual filtering (Req 10.4).
 */
function parseOptionalSubjectId(url: URL): string | null {
    const raw = url.searchParams.get('subjectId');
    if (raw === null || raw.trim() === '') {
        return null;
    }
    return raw.trim();
}

/**
 * The minimal persisted attempt shape this handler reads: its `createdAt` (the trend's
 * ordering/endpoint date) and its `perQuestion` Json. `timeTakenSec` is present only for a
 * Timed_Paper_Attempt (a PYQ attempt records no time — Req 9.4).
 */
interface RawAttempt {
    createdAt: Date;
    perQuestion: unknown;
    timeTakenSec: number | null;
}

/** One persisted per-question entry as stored in `perQuestion` Json: `{ questionId, outcome }`. */
interface RawQuestionOutcome {
    questionId: string;
    outcome: QuestionOutcome;
}

/** Sentinel `subjectId` for a question whose PYQ subject could not be resolved; it never
 * matches a real subject filter, so such a question simply drops out under a subject filter. */
const UNKNOWN_SUBJECT_ID = '';

/**
 * Coerce a persisted Prisma `Json` `perQuestion` value into the entries the trend consumes.
 * A non-array Json value degrades to an empty array, and entries without a string
 * `questionId` are skipped, so a malformed row yields an empty (zero-question) attempt rather
 * than throwing.
 */
function asPerQuestionEntries(perQuestion: unknown): RawQuestionOutcome[] {
    if (!Array.isArray(perQuestion)) {
        return [];
    }
    const entries: RawQuestionOutcome[] = [];
    for (const item of perQuestion) {
        if (
            item !== null &&
            typeof item === 'object' &&
            typeof (item as { questionId?: unknown }).questionId === 'string'
        ) {
            const record = item as { questionId: string; outcome: unknown };
            entries.push({
                questionId: record.questionId,
                outcome: record.outcome as QuestionOutcome,
            });
        }
    }
    return entries;
}

/**
 * Map a raw attempt onto the pure module's {@link AttemptQualityTrendInput}, attaching each
 * question's resolved `subjectId` (or the {@link UNKNOWN_SUBJECT_ID} sentinel when the
 * question has no known PYQ subject).
 */
function toTrendInput(
    attempt: RawAttempt,
    subjectByQuestionId: Map<string, string>,
): AttemptQualityTrendInput {
    const perQuestion: TrendQuestionOutcome[] = asPerQuestionEntries(attempt.perQuestion).map(
        (entry) => ({
            questionId: entry.questionId,
            outcome: entry.outcome,
            subjectId: subjectByQuestionId.get(entry.questionId) ?? UNKNOWN_SUBJECT_ID,
        }),
    );

    return {
        date: attempt.createdAt,
        perQuestion,
        timeTakenSec: attempt.timeTakenSec,
    };
}

/**
 * GET /api/analytics/attempt-quality-trend?subjectId=&from=&to=
 *
 * Loads the authenticated user's in-range `PYQAttempt` and `TimedPaperAttempt` rows (scoped
 * to `auth.user.id`, bounded by `createdAt` to the optional `[from, to]` range), resolves
 * each question's `PYQ.subjectId`, maps them onto the pure module's input shape, and returns
 * the discriminated {@link computeAttemptQualityTrend} result — a payload distinct from the
 * score trajectory (Req 10.2). Expects an authenticated {@link AuthContext}; the route file
 * wraps this with `withAuth` so unauthenticated requests are rejected upstream (Req 14.1).
 */
export async function getAttemptQualityTrendHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const url = new URL(request.url);

    const parsed = parseAttemptQualityTrendRange(url);
    if (!parsed.ok) {
        return parsed.response;
    }
    const subjectId = parseOptionalSubjectId(url);

    const userId = auth.user.id;

    // Inclusive [from, to] filter on createdAt, applied at the query level. An open bound is
    // simply omitted from the filter.
    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (parsed.range.from !== null) {
        createdAtFilter.gte = parsed.range.from;
    }
    if (parsed.range.to !== null) {
        createdAtFilter.lte = parsed.range.to;
    }
    const hasDateFilter = parsed.range.from !== null || parsed.range.to !== null;

    const [pyqAttemptRows, timedAttemptRows] = await Promise.all([
        prisma.pYQAttempt.findMany({
            where: {
                userId,
                ...(hasDateFilter ? { createdAt: createdAtFilter } : {}),
            },
            select: { createdAt: true, perQuestion: true },
        }),
        prisma.timedPaperAttempt.findMany({
            where: {
                userId,
                ...(hasDateFilter ? { createdAt: createdAtFilter } : {}),
            },
            select: { createdAt: true, perQuestion: true, timeTakenSec: true },
        }),
    ]);

    const rawAttempts: RawAttempt[] = [
        // PYQ attempts record no time taken (Req 9.4) -> timeTakenSec is null/unavailable.
        ...pyqAttemptRows.map((row) => ({
            createdAt: row.createdAt,
            perQuestion: row.perQuestion,
            timeTakenSec: null,
        })),
        ...timedAttemptRows.map((row) => ({
            createdAt: row.createdAt,
            perQuestion: row.perQuestion,
            timeTakenSec: row.timeTakenSec,
        })),
    ];

    // Resolve each referenced question's subject via PYQ (so attempts can be restricted to a
    // single Subject's questions — Req 10.4). Questions with no PYQ row carry the sentinel
    // subjectId and therefore never match a subject filter.
    const questionIds = new Set<string>();
    for (const attempt of rawAttempts) {
        for (const entry of asPerQuestionEntries(attempt.perQuestion)) {
            questionIds.add(entry.questionId);
        }
    }

    const subjectByQuestionId = new Map<string, string>();
    if (questionIds.size > 0) {
        const pyqRows = await prisma.pYQ.findMany({
            where: { id: { in: [...questionIds] } },
            select: { id: true, subjectId: true },
        });
        for (const pyq of pyqRows) {
            subjectByQuestionId.set(pyq.id, pyq.subjectId);
        }
    }

    const attempts: AttemptQualityTrendInput[] = rawAttempts.map((attempt) =>
        toTrendInput(attempt, subjectByQuestionId),
    );

    const result = computeAttemptQualityTrend(attempts, subjectId);

    return Response.json(result);
}
