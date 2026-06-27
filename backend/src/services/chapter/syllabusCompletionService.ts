/**
 * Syllabus completion computation handler (task 5.3; design "Chapter / Syllabus Tracking
 * Service"; Req 12.4, 12.5).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/syllabus/completion
 *     -> 200 { percent }   where `percent` = chapters whose status is DONE or REVISED
 *                          divided by the total chapter count, times 100, scoped to the
 *                          authenticated user (Req 12.4); 0 when the user has zero
 *                          chapters (Req 12.5).
 *
 * The handler is intentionally THIN: it loads only the authenticated user's chapter
 * statuses via Prisma and delegates the percentage calculation to the pure
 * {@link computeSyllabusCompletionPercent} from the dashboard aggregation module. Reusing
 * that one definition guarantees this endpoint and the `GET /dashboard`
 * `syllabusCompletionPercent` field can never drift apart.
 *
 * Per-user isolation: the query is scoped by `auth.user.id`; the route wraps this with
 * `withAuth` so unauthenticated requests are rejected upstream (Req 1.7).
 *
 * Out of scope for task 5.3 (do NOT touch here): the status-transition logic (task 5.1)
 * and the override endpoints (task 5.2).
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';

import { computeSyllabusCompletionPercent } from '@/services/dashboard/dashboardAggregation';

/**
 * Handle `GET /api/syllabus/completion`. Loads the authenticated user's chapter statuses
 * and returns the syllabus completion percentage computed by the shared pure function.
 */
export async function getSyllabusCompletionHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const chapters = await prisma.chapter.findMany({
        where: { userId: auth.user.id },
        select: { status: true },
    });

    const percent = computeSyllabusCompletionPercent(
        chapters.map((chapter) => chapter.status),
    );

    return Response.json({ percent });
}
