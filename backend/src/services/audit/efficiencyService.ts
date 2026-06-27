/**
 * Efficiency_Score read handler for the Daily Time Audit / Study Velocity Service
 * (task 10.2; design "Daily Time Audit / Study Velocity Service"; Req 14.4).
 *
 *   GET /api/audits/efficiency
 *     -> 200 { efficiencyScore }   where efficiencyScore = Σ actualMin / Σ plannedMin
 *                                  across the user's whole Daily_Time_Audit history, or 1
 *                                  when there are no audits / zero total planned time.
 *
 * The handler stays THIN: it loads only the authenticated user's audit planned/actual
 * minutes via Prisma and delegates the ratio to the pure {@link computeEfficiencyScore}.
 * That single definition is also used by timetable efficiency auto-scaling (Req 14.5) so the
 * two can never drift.
 *
 * Per-user isolation: the query is scoped by `auth.user.id`; the route wraps this with
 * `withAuth` so unauthenticated requests are rejected upstream (Req 1.7).
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';

import { computeEfficiencyScore } from './efficiencyScore';

/**
 * Handle `GET /api/audits/efficiency`. Loads the user's audit history and returns the
 * Efficiency_Score computed by the shared pure function.
 */
export async function getEfficiencyHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const audits = await prisma.dailyTimeAudit.findMany({
        where: { userId: auth.user.id },
        select: { plannedMin: true, actualMin: true },
    });

    const efficiencyScore = computeEfficiencyScore(audits);

    return Response.json({ efficiencyScore });
}
