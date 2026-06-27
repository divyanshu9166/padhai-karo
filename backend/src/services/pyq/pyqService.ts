/**
 * PYQ Practice retrieval service (task 11.2, design "PYQ Practice + Scoring Service").
 *
 * Serves the filtered PYQ listing endpoint described in the design table:
 *
 *   GET /api/pyqs?year=&subjectId=   -> 200 { questions[] } (track-scoped, Req 6.1)
 *
 * Behaviour (Req 6.1, 7.3):
 *   - Returns ONLY questions matching the requested `year` and `subjectId` AND the
 *     authenticated user's Exam_Track (read from their Profile).
 *   - EXCLUDES any question flagged for manual review (`flaggedForReview = true`). Such
 *     records are not practice-eligible (Req 7.3), so the filter always pins
 *     `flaggedForReview: false`.
 *   - Available to every Subscription_Tier (Req 6.6/9.4): the handler performs no tier
 *     gating. The only access control is the session guard (`withAuth`) that wraps the
 *     route.
 *
 * Client projection (documented decision, task 11.2):
 *   The practice listing deliberately OMITS `correctOption`. Returning the answer with the
 *   question would let a client read the key before submitting, defeating scoring. The
 *   listing therefore returns only `{ id, questionText, options }` — the question id, its
 *   text, and the four options. Authoritative scoring happens server-side on submission
 *   (task 11.3) via the shared pure scoring function. This omission is enforced twice: the
 *   Prisma query `select`s only the safe columns ({@link PYQ_CLIENT_SELECT}) so the answer
 *   never leaves the database layer, and {@link toClientPyq} re-projects defensively.
 *
 * Query-building, validation, and the client projection are kept as small pure functions
 * so they are unit-testable without a live database; the {@link pyqsHandler} wires them to
 * Prisma and the authenticated user.
 */
import type { ExamTrack, Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import prisma from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors/errorEnvelope';

/**
 * The shape returned to the client for a single PYQ in the practice listing. Note the
 * absence of `correctOption` (and any other answer-revealing field): see the module
 * docstring "Client projection".
 */
export interface ClientPYQ {
    id: string;
    questionText: string;
    options: string[];
}

/**
 * Prisma `select` for the practice listing. Restricts the columns fetched to exactly the
 * safe client projection so `correctOption` is never read out of the database for this
 * endpoint. Kept in sync with {@link ClientPYQ}.
 */
export const PYQ_CLIENT_SELECT = {
    id: true,
    questionText: true,
    options: true,
} as const satisfies Prisma.PYQSelect;

/** Result of parsing the `year` query param: a valid integer or a ready 422 `Response`. */
type YearParse = { ok: true; year: number } | { ok: false; response: Response };

/**
 * Parse the `year` query param as a valid integer (Req 6.1). Rejects missing, blank,
 * non-numeric, and non-integer (e.g. "2024.5") values with a 422 VALIDATION_ERROR. Only a
 * canonical, optionally-signed integer string is accepted — `Number()` coercion of inputs
 * like "0x7e0" or "2024abc" is deliberately avoided.
 */
export function parseYearParam(url: URL): YearParse {
    const raw = url.searchParams.get('year');
    if (raw === null || raw.trim() === '') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "year" is required.',
                { param: 'year' },
            ),
        };
    }
    if (!/^[+-]?\d+$/.test(raw.trim())) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "year" must be a valid integer.',
                { param: 'year', value: raw },
            ),
        };
    }
    return { ok: true, year: Number.parseInt(raw.trim(), 10) };
}

/** Result of parsing the `subjectId` query param: a non-empty string or a 422 `Response`. */
type SubjectIdParse = { ok: true; subjectId: string } | { ok: false; response: Response };

/**
 * Parse the `subjectId` query param, requiring a non-blank value (Req 6.1). A missing or
 * empty `subjectId` yields a 422 VALIDATION_ERROR.
 */
export function parseSubjectIdParam(url: URL): SubjectIdParse {
    const raw = url.searchParams.get('subjectId');
    if (raw === null || raw.trim() === '') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "subjectId" is required.',
                { param: 'subjectId' },
            ),
        };
    }
    return { ok: true, subjectId: raw.trim() };
}

/** The filter criteria for a PYQ practice query. */
export interface PyqFilterCriteria {
    examTrack: ExamTrack;
    year: number;
    subjectId: string;
}

/**
 * Build the Prisma `where` clause for the practice listing from the user's exam track and
 * the requested year/subject. The clause ALWAYS pins `flaggedForReview: false` so
 * questions awaiting manual review are excluded from practice (Req 7.3), independent of the
 * caller's input.
 */
export function buildPyqWhere(criteria: PyqFilterCriteria): Prisma.PYQWhereInput {
    return {
        examTrack: criteria.examTrack,
        year: criteria.year,
        subjectId: criteria.subjectId,
        flaggedForReview: false,
    };
}

/**
 * Defensively re-project a PYQ row to the client shape, dropping any field other than the
 * safe `{ id, questionText, options }`. Even though {@link PYQ_CLIENT_SELECT} already
 * limits the fetched columns, this guards against an accidentally over-broad query leaking
 * `correctOption`.
 */
export function toClientPyq(pyq: ClientPYQ): ClientPYQ {
    return {
        id: pyq.id,
        questionText: pyq.questionText,
        options: pyq.options,
    };
}

/**
 * GET /api/pyqs?year=&subjectId=
 *
 * Returns the practice-eligible PYQs matching the requested year, subject, and the
 * authenticated user's exam track, excluding any flagged for review. Available to all
 * tiers (no gating). The `correctOption` is never returned (see module docstring).
 *
 * Resolves the user's Exam_Track from their Profile; a user without a profile/track has
 * not completed onboarding, so the endpoint returns 404 NOT_FOUND directing them to
 * onboard rather than guessing a track.
 */
export async function pyqsHandler(request: Request, ctx: AuthContext): Promise<Response> {
    const url = new URL(request.url);

    const parsedYear = parseYearParam(url);
    if (!parsedYear.ok) {
        return parsedYear.response;
    }

    const parsedSubject = parseSubjectIdParam(url);
    if (!parsedSubject.ok) {
        return parsedSubject.response;
    }

    const profile = await prisma.profile.findUnique({
        where: { userId: ctx.user.id },
        select: { examTrack: true },
    });

    if (!profile) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'No profile found for the user. Complete onboarding to select an exam track.',
        );
    }

    const where = buildPyqWhere({
        examTrack: profile.examTrack,
        year: parsedYear.year,
        subjectId: parsedSubject.subjectId,
    });

    const rows = await prisma.pYQ.findMany({
        where,
        select: PYQ_CLIENT_SELECT,
        orderBy: { id: 'asc' },
    });

    return Response.json({ questions: rows.map(toClientPyq) });
}
