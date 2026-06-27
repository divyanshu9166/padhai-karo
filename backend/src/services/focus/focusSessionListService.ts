/**
 * Focus-session listing handler (task 8.2; design "Focus Timer / Session Service"; Req 4.3).
 *
 * Implements the read endpoint:
 *
 *   GET /api/focus-sessions?from=&to=
 *     -> 200 { sessions[] }  scoped to the authenticated user (Req 4.3)
 *     -> 422 VALIDATION_ERROR (from/to not a valid date-time, or from > to)
 *
 * The optional `from`/`to` query params bound the result by `startTime`:
 *   - when both are present, only sessions with `from <= startTime <= to` are returned;
 *   - when only one is present, only that bound is applied;
 *   - when neither is present, every session for the user is returned.
 *
 * Results are ordered deterministically most-recent-first (`startTime` desc, with `id` as
 * a stable tiebreaker). Query-param parsing/validation and where-clause building are kept
 * as small pure functions so they are unit-testable without a live database; the
 * {@link listFocusSessionsHandler} wires them to Prisma and the authenticated user.
 *
 * Every read is scoped to `auth.user.id` for per-user isolation (design "Authorization &
 * Per-User Isolation").
 */
import type { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

/**
 * A validated, optional `[from, to]` bound on `startTime`. Either or both ends may be
 * absent, meaning "unbounded on that side".
 */
export interface FocusSessionRange {
    from: Date | null;
    to: Date | null;
}

/** Discriminated result of {@link parseFocusSessionRange}. */
export type FocusSessionRangeParse =
    | { ok: true; range: FocusSessionRange }
    | { ok: false; response: Response };

/**
 * Deterministic ordering for the listing: most-recent-first by `startTime`, with `id` as a
 * stable tiebreaker so sessions sharing a `startTime` always come back in the same order.
 */
export const FOCUS_SESSION_ORDER_BY = [
    { startTime: 'desc' },
    { id: 'asc' },
] as const satisfies Prisma.FocusSessionOrderByWithRelationInput[];

/**
 * Parse an optional timestamp query param (ISO date-time string or epoch-millis string)
 * into a `Date`. Returns `null` when the param is absent/blank (meaning "no bound") and
 * `'invalid'` when present but unparseable, so the caller can distinguish "omitted" from
 * "provided but wrong".
 */
function parseOptionalTimestamp(raw: string | null): Date | null | 'invalid' {
    if (raw === null || raw.trim() === '') {
        return null;
    }
    const trimmed = raw.trim();
    // Accept a bare epoch-millis integer as well as ISO date-time strings.
    const candidate = /^[+-]?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed;
    const date = new Date(candidate);
    return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

/**
 * Parse and validate the optional `from`/`to` range query params (Req 4.3).
 *
 * Rules:
 *   - Each of `from`/`to`, when present, must be a valid timestamp (else 422).
 *   - When both are present, `from` must be less than or equal to `to` (else 422).
 *   - When omitted, the corresponding bound is left open.
 *
 * Pure: performs no I/O. Accepts a `URL` so it can be unit-tested by constructing request
 * URLs directly.
 */
export function parseFocusSessionRange(url: URL): FocusSessionRangeParse {
    const from = parseOptionalTimestamp(url.searchParams.get('from'));
    if (from === 'invalid') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "from" must be a valid date-time.',
                { param: 'from' },
            ),
        };
    }

    const to = parseOptionalTimestamp(url.searchParams.get('to'));
    if (to === 'invalid') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Query parameter "to" must be a valid date-time.',
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
 * Build the Prisma `where` clause for the listing. ALWAYS pins `userId` for per-user
 * isolation (Req 4.3) and applies a `startTime` range filter only for the bounds that were
 * provided. When neither bound is present, no `startTime` constraint is added.
 */
export function buildFocusSessionWhere(
    userId: string,
    range: FocusSessionRange,
): Prisma.FocusSessionWhereInput {
    const where: Prisma.FocusSessionWhereInput = { userId };

    if (range.from !== null || range.to !== null) {
        const startTime: Prisma.DateTimeFilter = {};
        if (range.from !== null) {
            startTime.gte = range.from;
        }
        if (range.to !== null) {
            startTime.lte = range.to;
        }
        where.startTime = startTime;
    }

    return where;
}

/**
 * GET /api/focus-sessions?from=&to=
 *
 * Returns the authenticated user's focus sessions, optionally bounded by `startTime` to
 * the `[from, to]` range, ordered most-recent-first. Expects an authenticated
 * {@link AuthContext}; the route file wraps this with `withAuth` so unauthenticated
 * requests are rejected upstream.
 */
export async function listFocusSessionsHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const url = new URL(request.url);

    const parsed = parseFocusSessionRange(url);
    if (!parsed.ok) {
        return parsed.response;
    }

    const where = buildFocusSessionWhere(auth.user.id, parsed.range);

    const sessions = await prisma.focusSession.findMany({
        where,
        orderBy: [...FOCUS_SESSION_ORDER_BY],
    });

    return Response.json({ sessions });
}
