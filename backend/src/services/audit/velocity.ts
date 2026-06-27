/**
 * Pure Study_Velocity projection for the Daily Time Audit / Study Velocity Service
 * (task 10.2; design "Efficiency Score & Study Velocity"; Req 14.6, 14.7, 14.8).
 *
 * Three independent pure pieces, all database- and framework-free so they unit-test without
 * a live DB and back the property test (Property 30 / task 10.5):
 *
 *   1. {@link computeRemainingHours} — Σ effective Estimated_Study_Hours of *pending*
 *      chapters (status NOT_STARTED or IN_PROGRESS), using `estHoursOverride` when present
 *      else `estimatedStudyHours` (Req 14.7; override precedence per Req 11.3/11.4).
 *   2. {@link computeRecentRatePerDay} — the User's recent actual study rate in HOURS PER
 *      DAY, derived from recent Daily_Time_Audit rows (see window decision below).
 *   3. {@link projectVelocity} — projects the syllabus completion date from remaining hours
 *      and recent rate, then compares it to the Target_Completion_Date to report AHEAD /
 *      BEHIND and the whole-day difference (Req 14.7, 14.8).
 *
 * Target_Completion_Date itself (`Target_Exam_Date − Revision_Buffer`, Req 14.6) is NOT
 * recomputed here: the handler reuses `computeTargetCompletionDate` from the NTA worker
 * (`workers/ntaIngestion/examDate.ts`) so the two never drift.
 *
 * ── Recent-rate window decision ─────────────────────────────────────────────────────────
 * "Recent actual study rate" uses a rolling window of the last {@link RECENT_RATE_WINDOW_DAYS}
 * (7) UTC days ending today — the same 7-day rolling notion the Progress Dashboard uses for
 * the "current week". The rate is the total actual minutes recorded in that window divided by
 * the FULL window length in days (not by the count of days that happen to have an audit):
 *
 *   recentRatePerDay (hours/day) = (Σ actualMin in window / 60) / RECENT_RATE_WINDOW_DAYS
 *
 * Dividing by the fixed window length (rather than only the audited days) means days with no
 * logged study correctly drag the rate down, giving a realistic recent pace. Daily_Time_Audit
 * `actualMin` is used as the single source of truth for actual study time because task 10.1
 * already derives it from that day's Focus_Sessions when any exist, so reading audits avoids
 * double-counting sessions.
 *
 * ── Zero-rate decision ──────────────────────────────────────────────────────────────────
 * If the recent rate is `0` (no recent logged study) and work still remains, the completion
 * date cannot be projected. Per the design ("If recentRate = 0, projection is reported as
 * indefinite/behind") {@link projectVelocity} returns a `null` projectedCompletionDate and
 * `null` deltaDays with status `BEHIND`. The one exception is when there is no work left
 * (remainingHours ≤ 0): the syllabus is already complete, so the projected date is today
 * regardless of rate.
 */
import { startOfUtcDay } from '@/services/dashboard';

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Minutes in one hour. */
const MIN_PER_HOUR = 60;

/** Rolling window (in UTC days, ending today) used to derive the recent study rate. */
export const RECENT_RATE_WINDOW_DAYS = 7;

/** Whether a chapter status counts as "pending" (still needs study time). */
const PENDING_STATUSES = new Set(['NOT_STARTED', 'IN_PROGRESS']);

/**
 * The chapter fields needed to sum remaining study hours. `status` is compared as a string
 * so the function does not depend on the Prisma enum import. `estHoursOverride` takes
 * precedence over `estimatedStudyHours` when present (non-null).
 */
export interface VelocityChapterRow {
    status: string;
    estimatedStudyHours: number;
    estHoursOverride?: number | null;
}

/** A Daily_Time_Audit row as needed to derive the recent study rate. */
export interface VelocityAuditRow {
    date: Date;
    actualMin: number;
}

/** Whether a chapter is pending (NOT_STARTED or IN_PROGRESS) and thus still needs time. */
export function isPendingChapter(status: string): boolean {
    return PENDING_STATUSES.has(status);
}

/** The effective estimated study hours for a chapter: override when present, else base. */
export function effectiveEstimatedHours(chapter: VelocityChapterRow): number {
    return chapter.estHoursOverride ?? chapter.estimatedStudyHours;
}

/**
 * Sum the effective Estimated_Study_Hours of *pending* chapters (Req 14.7). Non-pending
 * chapters (DONE / REVISED) contribute nothing. Pure; returns 0 for an empty list or when
 * no chapter is pending.
 */
export function computeRemainingHours(chapters: readonly VelocityChapterRow[]): number {
    return chapters.reduce((total, chapter) => {
        if (!isPendingChapter(chapter.status)) {
            return total;
        }
        return total + effectiveEstimatedHours(chapter);
    }, 0);
}

/**
 * Derive the recent actual study rate in HOURS PER DAY from the audit history (see the
 * window decision in the module doc).
 *
 * @param audits - the user's Daily_Time_Audit rows (any order; rows outside the window are
 *   ignored).
 * @param now - reference "today" instant; the window is the last
 *   {@link RECENT_RATE_WINDOW_DAYS} UTC days ending on the UTC day containing `now`.
 * @returns total actual hours in the window divided by the window length in days; `0` when
 *   no audited minutes fall in the window.
 *
 * Pure: no I/O, no mutation of inputs.
 */
export function computeRecentRatePerDay(
    audits: readonly VelocityAuditRow[],
    now: Date,
): number {
    const todayStart = startOfUtcDay(now);
    const windowEnd = todayStart.getTime() + MS_PER_DAY; // exclusive: end of today
    const windowStart = todayStart.getTime() - (RECENT_RATE_WINDOW_DAYS - 1) * MS_PER_DAY;

    let totalMin = 0;
    for (const audit of audits) {
        const t = audit.date.getTime();
        if (t >= windowStart && t < windowEnd) {
            totalMin += audit.actualMin;
        }
    }

    const totalHours = totalMin / MIN_PER_HOUR;
    return totalHours / RECENT_RATE_WINDOW_DAYS;
}

/** The Study_Velocity status: ahead of or behind the Target_Completion_Date. */
export type VelocityStatus = 'AHEAD' | 'BEHIND';

/** The fully-projected Study_Velocity result returned to the client (Req 14.7, 14.8). */
export interface VelocityProjection {
    /** Projected syllabus completion date, or `null` when indefinite (zero rate, work left). */
    projectedCompletionDate: Date | null;
    /** Target_Completion_Date = Target_Exam_Date − Revision_Buffer (Req 14.6). */
    targetCompletionDate: Date;
    /** Whole-day magnitude between projected and target dates; `null` when indefinite. */
    deltaDays: number | null;
    /** Whether the projection is AHEAD of or BEHIND the Target_Completion_Date (Req 14.8). */
    status: VelocityStatus;
}

/** Inputs to {@link projectVelocity}; all pre-computed so the projection stays pure. */
export interface ProjectVelocityInput {
    /** Σ effective estimated hours of pending chapters (from {@link computeRemainingHours}). */
    remainingHours: number;
    /** Recent study rate in hours/day (from {@link computeRecentRatePerDay}). */
    recentRatePerDay: number;
    /** Target_Completion_Date (from `computeTargetCompletionDate`). */
    targetCompletionDate: Date;
    /** Reference "today" instant; the projection counts whole UTC days from this day. */
    now: Date;
}

/**
 * Project the syllabus completion date and compare it to the Target_Completion_Date
 * (Req 14.7, 14.8).
 *
 *   projectedDays            = ceil(remainingHours / recentRatePerDay)
 *   projectedCompletionDate  = startOfUtcDay(now) + projectedDays days
 *   deltaDays                = |whole UTC-day difference between projected and target|
 *   status                   = AHEAD when projected ≤ target (on-time counts as ahead),
 *                              else BEHIND
 *
 * Special cases:
 *   - remainingHours ≤ 0  → nothing left to study, so projected = today (projectedDays 0),
 *     regardless of the rate.
 *   - recentRatePerDay ≤ 0 with work remaining → indefinite: projectedCompletionDate and
 *     deltaDays are `null` and status is BEHIND (cannot finish at a zero pace).
 *
 * Pure: no I/O, no mutation of inputs.
 */
export function projectVelocity(input: ProjectVelocityInput): VelocityProjection {
    const { remainingHours, recentRatePerDay, targetCompletionDate, now } = input;
    const todayStart = startOfUtcDay(now);

    // Nothing left to study: complete as of today, irrespective of rate.
    if (remainingHours <= 0) {
        const projectedCompletionDate = todayStart;
        return finalize(projectedCompletionDate, targetCompletionDate);
    }

    // Work remains but no recent pace: cannot project a finish date (indefinite/behind).
    if (recentRatePerDay <= 0) {
        return {
            projectedCompletionDate: null,
            targetCompletionDate,
            deltaDays: null,
            status: 'BEHIND',
        };
    }

    const projectedDays = Math.ceil(remainingHours / recentRatePerDay);
    const projectedCompletionDate = new Date(todayStart.getTime() + projectedDays * MS_PER_DAY);
    return finalize(projectedCompletionDate, targetCompletionDate);
}

/** Build the AHEAD/BEHIND result and whole-day delta for a concrete projected date. */
function finalize(projectedCompletionDate: Date, targetCompletionDate: Date): VelocityProjection {
    const projectedDayStart = startOfUtcDay(projectedCompletionDate).getTime();
    const targetDayStart = startOfUtcDay(targetCompletionDate).getTime();
    const deltaDays = Math.round(Math.abs(targetDayStart - projectedDayStart) / MS_PER_DAY);
    const status: VelocityStatus = projectedDayStart <= targetDayStart ? 'AHEAD' : 'BEHIND';
    return { projectedCompletionDate, targetCompletionDate, deltaDays, status };
}
