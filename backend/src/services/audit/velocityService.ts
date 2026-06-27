/**
 * Study_Velocity read handler for the Daily Time Audit / Study Velocity Service
 * (task 10.2; design "Efficiency Score & Study Velocity"; Req 14.6, 14.7, 14.8).
 *
 *   GET /api/velocity
 *     -> 200 { projectedCompletionDate, targetCompletionDate, deltaDays, status }
 *     -> 422 VALIDATION_ERROR when the user has no Target_Exam_Date (cannot compute a
 *            Target_Completion_Date — see note below)
 *
 * The handler stays THIN: it loads the authenticated user's profile (Target_Exam_Date +
 * Revision_Buffer), pending-chapter estimated hours, and recent audits, then delegates every
 * calculation to pure functions:
 *   - `computeTargetCompletionDate` (reused from the NTA worker `examDate.ts`) for
 *     Target_Completion_Date = Target_Exam_Date − Revision_Buffer (Req 14.6) — reused so the
 *     velocity endpoint and the NTA exam-date propagation can never drift.
 *   - {@link computeRemainingHours}, {@link computeRecentRatePerDay}, {@link projectVelocity}
 *     for the projection and AHEAD/BEHIND comparison (Req 14.7, 14.8).
 *
 * Dates are serialized as ISO-8601 strings (`Date#toJSON`); `projectedCompletionDate` and
 * `deltaDays` are `null` when the projection is indefinite (zero recent rate with work left).
 *
 * Per-user isolation: every query is scoped by `auth.user.id`; the route wraps this with
 * `withAuth` so unauthenticated requests are rejected upstream (Req 1.7).
 *
 * NOTE: a Target_Exam_Date is seeded for onboarded users, but it is nullable in the schema
 * (set/updated by onboarding and the NTA worker). Without it there is no Target_Completion_Date
 * to compare against, so the handler returns 422 rather than inventing a date.
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { computeTargetCompletionDate } from '@/workers/ntaIngestion/examDate';

import {
    computeRecentRatePerDay,
    computeRemainingHours,
    projectVelocity,
} from './velocity';

/**
 * Handle `GET /api/velocity`. Assembles the Study_Velocity payload from the user's profile,
 * pending chapters, and recent audits via the pure projection functions.
 *
 * @param now - injectable reference instant for "today"; defaults to the current time.
 *   Exposed so tests can pin the clock without mocking globals.
 */
export async function getVelocityHandler(
    _request: Request,
    auth: AuthContext,
    now: Date = new Date(),
): Promise<Response> {
    const profile = await prisma.profile.findUnique({
        where: { userId: auth.user.id },
        select: { targetExamDate: true, revisionBufferDays: true },
    });

    if (!profile || profile.targetExamDate === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'A target exam date is required to project study velocity.',
        );
    }

    const targetCompletionDate = computeTargetCompletionDate(
        profile.targetExamDate,
        profile.revisionBufferDays,
    );

    const chapters = await prisma.chapter.findMany({
        where: { userId: auth.user.id },
        select: { status: true, estimatedStudyHours: true, estHoursOverride: true },
    });

    const audits = await prisma.dailyTimeAudit.findMany({
        where: { userId: auth.user.id },
        select: { date: true, actualMin: true },
    });

    const remainingHours = computeRemainingHours(chapters);
    const recentRatePerDay = computeRecentRatePerDay(audits, now);

    const projection = projectVelocity({
        remainingHours,
        recentRatePerDay,
        targetCompletionDate,
        now,
    });

    return Response.json(projection);
}
