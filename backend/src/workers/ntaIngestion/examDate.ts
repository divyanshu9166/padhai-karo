/**
 * Pure exam-date recomputation for NTA exam-date changes (Req 20.6).
 *
 * When an ingested announcement moves a relevant exam date, every affected user's
 * `Target_Exam_Date` is updated and their `Target_Completion_Date` and exam countdown
 * are recomputed:
 *
 *   Target_Completion_Date = Target_Exam_Date − Revision_Buffer (days)
 *   countdownDays          = whole days from "now" until Target_Exam_Date (floored at 0)
 *
 * These helpers are pure (no DB/clock side effects: "now" is passed in) so they can be
 * unit-tested directly. The worker uses {@link applyExamDateChange} to compute the
 * per-user updates it then persists.
 */

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute `Target_Completion_Date = targetExamDate − revisionBufferDays`.
 *
 * Subtraction is performed in UTC-day units so it is stable regardless of the host
 * timezone. The input date is not mutated.
 */
export function computeTargetCompletionDate(targetExamDate: Date, revisionBufferDays: number): Date {
    return new Date(targetExamDate.getTime() - revisionBufferDays * MS_PER_DAY);
}

/**
 * Whole days remaining from `now` until `targetExamDate`, never negative.
 *
 * Uses `Math.ceil` so any positive fraction of a day still counts as a remaining day;
 * once the exam instant has passed the countdown is `0`.
 */
export function computeCountdownDays(targetExamDate: Date, now: Date): number {
    const diffMs = targetExamDate.getTime() - now.getTime();
    if (diffMs <= 0) {
        return 0;
    }
    return Math.ceil(diffMs / MS_PER_DAY);
}

/** A profile's identity and revision buffer, as needed to recompute its dates. */
export interface ProfileExamInput {
    userId: string;
    revisionBufferDays: number;
}

/** The recomputed exam dates for a single affected profile. */
export interface ProfileExamUpdate {
    userId: string;
    targetExamDate: Date;
    targetCompletionDate: Date;
    countdownDays: number;
}

/**
 * Given the affected profiles and a new exam date, compute each profile's updated
 * `Target_Exam_Date`, recomputed `Target_Completion_Date`, and exam countdown (Req 20.6).
 *
 * Pure: returns the updates to apply without performing any I/O.
 */
export function applyExamDateChange(
    profiles: ReadonlyArray<ProfileExamInput>,
    newExamDate: Date,
    now: Date,
): ProfileExamUpdate[] {
    return profiles.map((profile) => ({
        userId: profile.userId,
        targetExamDate: newExamDate,
        targetCompletionDate: computeTargetCompletionDate(newExamDate, profile.revisionBufferDays),
        countdownDays: computeCountdownDays(newExamDate, now),
    }));
}
