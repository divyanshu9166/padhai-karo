/**
 * Pure aggregation logic for the Progress Dashboard Service (task 9.1; design "Progress
 * Dashboard Service"; Req 5.1, 5.2, 5.3, 5.4, 5.5, 12.4).
 *
 * The dashboard endpoint surfaces three derived figures, each computed here as a
 * framework- and database-free pure function so it can be unit-tested in isolation and
 * reused by the property tests (Property 23 aggregation / task 9.2, Property 24 streak /
 * task 9.3) and the dashboard handler:
 *
 *   1. Per-subject focused study time for the current day and the current week
 *      ({@link aggregateFocusBySubject} + the period filters). Each Focus_Session counts
 *      under exactly one subject (Req 5.3) because every row carries a single `subjectId`.
 *   2. The streak: the number of consecutive days, ending today, on which the user
 *      completed at least one Focus_Session; zero when there is no session today
 *      ({@link computeStreak}, Req 5.4/5.5).
 *   3. Syllabus completion percent: chapters whose status is DONE or REVISED over the
 *      total chapter count; 0% when the user has no chapters
 *      ({@link computeSyllabusCompletionPercent}, Req 12.4/12.5).
 *
 * ── Day / week boundary decision (documented for task 9.1) ──────────────────────────────
 * All day boundaries use the **UTC calendar day**. This is deterministic, independent of
 * the host server's local timezone, tamper-resistant (the client never decides the
 * boundary), and consistent with the existing NTA exam-date logic which also works in
 * UTC-day units. Concretely:
 *
 *   - "current day"  = the UTC calendar day containing the reference instant `now`,
 *                      i.e. the half-open interval [startOfUtcDay(now), +1 day).
 *   - "current week" = a ROLLING window of the last 7 UTC days ending today, i.e. today
 *                      plus the previous 6 UTC days: [startOfUtcDay(now) − 6 days, +1 day).
 *   - the streak's day boundary is the SAME UTC calendar day, so "a session today" in the
 *     streak and "a session in the current day" in the per-subject totals agree exactly.
 *
 * A rolling 7-day week (rather than a Mon/Sun calendar week) keeps the "current week"
 * figure stable as the user studies through the week and matches the streak's
 * ending-today framing.
 */
import type { ChapterStatus } from '@prisma/client';

/** Milliseconds in one day; used for UTC-day arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A raw Focus_Session row as needed for dashboard aggregation. Deliberately minimal: only
 * the subject the time counts toward (Req 5.3), the focused duration to sum (Req 5.2), and
 * the start instant used to bucket the session into a day/week (Req 5.1).
 */
export interface FocusSessionRow {
    subjectId: string;
    focusedDurationMin: number;
    startTime: Date;
}

/** A per-subject focused-time total returned to the client. */
export interface PerSubjectStudyTime {
    subjectId: string;
    focusedDurationMin: number;
}

/** A half-open time window `[start, end)` used to scope sessions to a period. */
export interface TimeWindow {
    start: Date;
    end: Date;
}

/**
 * The UTC midnight that begins the calendar day containing `date`. Pure; does not mutate
 * its argument.
 */
export function startOfUtcDay(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
}

/**
 * A stable `YYYY-MM-DD` key identifying the UTC calendar day of `date`. Two instants on the
 * same UTC day share a key, which is how sessions are bucketed for the streak.
 */
export function utcDayKey(date: Date): string {
    return startOfUtcDay(date).toISOString().slice(0, 10);
}

/**
 * The current-day window: the half-open UTC day `[startOfUtcDay(now), +1 day)` (Req 5.1).
 */
export function currentDayWindow(now: Date): TimeWindow {
    const start = startOfUtcDay(now);
    return { start, end: new Date(start.getTime() + MS_PER_DAY) };
}

/**
 * The current-week window: a rolling 7 UTC days ending today, i.e. today plus the previous
 * six days, `[startOfUtcDay(now) − 6 days, +1 day)` (Req 5.1). See the module-level
 * boundary decision for why a rolling week is used.
 */
export function currentWeekWindow(now: Date): TimeWindow {
    const startOfToday = startOfUtcDay(now);
    return {
        start: new Date(startOfToday.getTime() - 6 * MS_PER_DAY),
        end: new Date(startOfToday.getTime() + MS_PER_DAY),
    };
}

/**
 * Keep only the sessions whose `startTime` falls in the half-open window `[start, end)`.
 * Pure; returns a new array and does not mutate its input.
 */
export function filterSessionsInWindow(
    sessions: readonly FocusSessionRow[],
    window: TimeWindow,
): FocusSessionRow[] {
    const startMs = window.start.getTime();
    const endMs = window.end.getTime();
    return sessions.filter((session) => {
        const t = session.startTime.getTime();
        return t >= startMs && t < endMs;
    });
}

/**
 * Sum focused duration per subject across the given sessions (Req 5.2). Each session
 * contributes its `focusedDurationMin` to exactly one subject bucket (Req 5.3). The result
 * is sorted by `subjectId` for deterministic output. Subjects with no sessions are not
 * included (the handler decides whether to backfill zero rows for known subjects).
 *
 * Pure: no I/O, no mutation of inputs.
 */
export function aggregateFocusBySubject(
    sessions: readonly FocusSessionRow[],
): PerSubjectStudyTime[] {
    const totals = new Map<string, number>();
    for (const session of sessions) {
        const previous = totals.get(session.subjectId) ?? 0;
        totals.set(session.subjectId, previous + session.focusedDurationMin);
    }
    return [...totals.entries()]
        .map(([subjectId, focusedDurationMin]) => ({ subjectId, focusedDurationMin }))
        .sort((a, b) => (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0));
}

/**
 * Compute the streak: the number of consecutive UTC days, ending today, on which the user
 * had at least one Focus_Session (Req 5.4). If there is no session on today's UTC day, the
 * streak is zero regardless of any earlier history (Req 5.5).
 *
 * @param sessionDays - the start instants of the user's focus sessions (any order, any
 *   number per day; duplicates within a day collapse to a single "active day").
 * @param now - the reference instant whose UTC day is "today".
 *
 * Pure: builds a set of active UTC day-keys and walks backward from today.
 */
export function computeStreak(sessionDays: readonly Date[], now: Date): number {
    const activeDays = new Set<string>();
    for (const day of sessionDays) {
        activeDays.add(utcDayKey(day));
    }

    let streak = 0;
    let cursor = startOfUtcDay(now);
    while (activeDays.has(cursor.toISOString().slice(0, 10))) {
        streak += 1;
        cursor = new Date(cursor.getTime() - MS_PER_DAY);
    }
    return streak;
}

/** Chapter statuses that count as completed syllabus for Req 12.4. */
const COMPLETED_CHAPTER_STATUSES: ReadonlySet<ChapterStatus> = new Set<ChapterStatus>([
    'DONE',
    'REVISED',
]);

/**
 * Compute the syllabus completion percent: the count of chapters whose status is DONE or
 * REVISED divided by the total chapter count, times 100 (Req 12.4). Reports 0 when the user
 * has zero chapters (Req 12.5), avoiding a divide-by-zero.
 *
 * The result is rounded to two decimal places so the output is clean and deterministic
 * (e.g. 1 of 3 chapters → 33.33). Pure: no I/O.
 */
export function computeSyllabusCompletionPercent(
    statuses: readonly ChapterStatus[],
): number {
    if (statuses.length === 0) {
        return 0;
    }
    const completed = statuses.filter((status) =>
        COMPLETED_CHAPTER_STATUSES.has(status),
    ).length;
    return Math.round((completed / statuses.length) * 10000) / 100;
}
