/**
 * Daily Time Audit Service handler (task 10.1; design "Daily Time Audit / Study Velocity
 * Service"; Req 14.1, 14.2, 14.3).
 *
 * Implements the end-of-day check-in endpoint:
 *
 *   POST /api/audits/daily
 *     body: { date, plannedMin, actualMin? }
 *     -> 201 { audit }
 *     -> 422 VALIDATION_ERROR (invalid date / negative-or-fractional plannedMin / bad actualMin)
 *
 * The handler stays THIN: it parses + validates the body (via the pure
 * {@link validateDailyAuditInput}), loads that day's Focus_Sessions, derives the actual
 * study time (via the pure {@link resolveActualMin}), and upserts a Daily_Time_Audit scoped
 * to the authenticated user.
 *
 * ── Day boundary ────────────────────────────────────────────────────────────────────────
 * "That day" uses the same UTC-calendar-day convention as the Progress Dashboard
 * (task 9.1): the day is the half-open interval `[startOfUtcDay(date), +1 day)`, and the
 * `startOfUtcDay` helper is reused from the dashboard aggregation module so the audit and
 * dashboard agree exactly on what "today" means. The stored `DailyTimeAudit.date` is
 * normalized to that UTC midnight so the `@@unique([userId, date])` constraint treats every
 * check-in for the same calendar day as the same row.
 *
 * ── Upsert (re-submission) ──────────────────────────────────────────────────────────────
 * The write is an upsert keyed on `(userId, date)` so re-submitting the same day's check-in
 * updates the existing audit (refreshing planned/actual) rather than violating the unique
 * constraint. Per-user isolation: the key and every field are scoped to `auth.user.id`; the
 * route wraps this with `withAuth` so unauthenticated requests are rejected upstream.
 *
 * NOTE: the Efficiency_Score (GET /audits/efficiency) and Study_Velocity (GET /velocity)
 * endpoints are task 10.2 and are intentionally NOT implemented here.
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { startOfUtcDay } from '@/services/dashboard';

import { validateDailyAuditInput } from './auditValidation';
import { resolveActualMin } from './resolveActualMin';

/** Milliseconds in one day; used to bound the audited UTC day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Safely parse a JSON request body, returning `undefined` when the body is absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Handle `POST /api/audits/daily`. Expects an authenticated {@link AuthContext}; the route
 * file wraps this with `withAuth` so unauthenticated requests are rejected upstream. Every
 * read and write is scoped to `auth.user.id` for per-user isolation.
 */
export async function recordDailyAuditHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    if (typeof body !== 'object' || body === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must be a JSON object.',
        );
    }

    const validation = validateDailyAuditInput(body as Record<string, unknown>);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const { date, plannedMin, userEnteredActual } = validation.value;

    // Bound the audited day to the UTC calendar day (matches the dashboard convention).
    const dayStart = startOfUtcDay(date);
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);

    // Load that day's focus sessions for this user; their summed focused minutes are the
    // source of truth for actual study time when any exist (Req 14.2).
    const daySessions = await prisma.focusSession.findMany({
        where: {
            userId: auth.user.id,
            startTime: { gte: dayStart, lt: dayEnd },
        },
        select: { focusedDurationMin: true },
    });

    const actualMin = resolveActualMin(daySessions, userEnteredActual);

    // Upsert keyed on (userId, date) so a re-submitted check-in updates instead of failing
    // the unique constraint (Req 14.1).
    const audit = await prisma.dailyTimeAudit.upsert({
        where: { userId_date: { userId: auth.user.id, date: dayStart } },
        create: { userId: auth.user.id, date: dayStart, plannedMin, actualMin },
        update: { plannedMin, actualMin },
    });

    return Response.json({ audit }, { status: 201 });
}
