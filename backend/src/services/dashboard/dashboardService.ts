/**
 * Progress Dashboard Service handler (task 9.1; design "Progress Dashboard Service";
 * Req 5.1, 5.2, 5.3, 5.4, 5.5, 12.4).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/dashboard
 *     -> 200 { perSubjectToday[], perSubjectWeek[], streak, syllabusCompletionPercent }
 *
 * The handler is intentionally THIN: it loads the authenticated user's raw rows via Prisma
 * (focus sessions in the current rolling week, and chapter statuses), then delegates every
 * calculation to the pure functions in {@link ./dashboardAggregation}. This keeps the
 * derivation logic (per-subject sums, streak, completion percent) database-independent and
 * unit-/property-testable.
 *
 * Per-user isolation: every query is scoped by `auth.user.id`; the route wraps this with
 * `withAuth` so unauthenticated requests are rejected upstream (Req 1.7).
 *
 * Day/week boundaries are UTC-based; see the boundary decision documented in
 * {@link ./dashboardAggregation}.
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';

import {
    aggregateFocusBySubject,
    computeStreak,
    computeSyllabusCompletionPercent,
    currentDayWindow,
    currentWeekWindow,
    filterSessionsInWindow,
    type FocusSessionRow,
} from './dashboardAggregation';

/**
 * Handle `GET /api/dashboard`. Loads the user's recent focus sessions and chapter statuses
 * and assembles the dashboard payload via the pure aggregation functions.
 *
 * @param now - injectable reference instant for "today"; defaults to the current time.
 *   Exposed so tests can pin the clock without mocking globals.
 */
export async function getDashboardHandler(
    _request: Request,
    auth: AuthContext,
    now: Date = new Date(),
): Promise<Response> {
    const weekWindow = currentWeekWindow(now);
    const dayWindow = currentDayWindow(now);

    // Load only the sessions that can possibly contribute to the current day or week (the
    // week window is the wider of the two), scoped to the authenticated user. The streak
    // can extend further back than a week, so load the day-keys for streak counting via a
    // separate, lighter query below.
    const weekSessions = await prisma.focusSession.findMany({
        where: {
            userId: auth.user.id,
            startTime: { gte: weekWindow.start, lt: weekWindow.end },
        },
        select: { subjectId: true, focusedDurationMin: true, startTime: true },
    });

    // For the streak we only need the start instants of every session up to and including
    // today; the pure computeStreak collapses multiple sessions on a day into one active
    // day and stops at the first gap, so loading all start times is sufficient and simple.
    const streakRows = await prisma.focusSession.findMany({
        where: {
            userId: auth.user.id,
            startTime: { lt: dayWindow.end },
        },
        select: { startTime: true },
        orderBy: { startTime: 'desc' },
    });

    const chapters = await prisma.chapter.findMany({
        where: { userId: auth.user.id },
        select: { status: true },
    });

    const sessions: FocusSessionRow[] = weekSessions;

    const perSubjectToday = aggregateFocusBySubject(
        filterSessionsInWindow(sessions, dayWindow),
    );
    const perSubjectWeek = aggregateFocusBySubject(sessions);
    const streak = computeStreak(
        streakRows.map((row) => row.startTime),
        now,
    );
    const syllabusCompletionPercent = computeSyllabusCompletionPercent(
        chapters.map((chapter) => chapter.status),
    );

    return Response.json({
        perSubjectToday,
        perSubjectWeek,
        streak,
        syllabusCompletionPercent,
    });
}
