/**
 * Pure attempt-quality computation (Req 9.1–9.5).
 *
 * This module is intentionally free of any database, Prisma, or framework
 * dependencies so it is a trivially testable pure function of an attempt's
 * persisted per-question outcomes plus an optional total time taken. It mirrors
 * the pure-module convention of `lib/scoring/score.ts`: it imports no generated
 * Prisma client and reuses the `QuestionOutcome` literal values directly.
 *
 * The Analytics_Service computes the Attempt_Quality_Score components from an
 * attempt's persisted per-question outcomes WITHOUT modifying the stored
 * PYQAttempt or TimedPaperAttempt (Req 9.5). Because this function is database
 * free and receives already-read rows, it structurally cannot write; it also
 * does not mutate its inputs (the no-mutation property 12 tests this).
 *
 * Metrics (Req 9.1):
 * - `accuracyPercent`     — correct / attempted * 100, or 0 when no attempted
 *                           questions (Req 9.2, 9.3).
 * - `averageTimePerQuestion` — totalTime / total questions, or `null` when no
 *                           time was recorded (PYQ attempts carry no time —
 *                           Req 9.4) or there are no questions.
 * - `unattemptedCount`    — number of UNANSWERED questions.
 * - `attemptRate`         — attempted / total * 100, or 0 when no questions.
 */

import { QuestionOutcome } from '../../lib/scoring/score';

/**
 * One question's persisted outcome within an attempt. This is the DB-free input
 * shape mirroring the `{ questionId, outcome }` entries stored in
 * `PYQAttempt.perQuestion` / `TimedPaperAttempt.perQuestion`.
 */
export interface AttemptQuestionOutcome {
    questionId: string;
    outcome: QuestionOutcome;
}

/**
 * The computed quality metrics for a single attempt (Req 9.1).
 *
 * `averageTimePerQuestion` is `null` when time is unavailable (e.g. a PYQ
 * attempt that records no time taken — Req 9.4).
 */
export interface AttemptQuality {
    accuracyPercent: number;
    averageTimePerQuestion: number | null;
    unattemptedCount: number;
    attemptRate: number;
}

/**
 * Compute an attempt's quality metrics from its per-question outcomes and an
 * optional total time taken (in seconds).
 *
 * Read-only: this function does not mutate `perQuestion` or any of its entries.
 *
 * @param perQuestion   The attempt's persisted per-question outcomes.
 * @param timeTakenSec  Total time taken in seconds, or `null`/`undefined` when
 *                      the attempt records no time (PYQ attempts — Req 9.4).
 * @returns The attempt's Accuracy_Percentage, Average_Time_Per_Question,
 *          Unattempted_Count, and Attempt_Rate.
 */
export function computeAttemptQuality(
    perQuestion: ReadonlyArray<AttemptQuestionOutcome>,
    timeTakenSec?: number | null,
): AttemptQuality {
    const total = perQuestion.length;

    let unattemptedCount = 0;
    let correct = 0;
    for (const entry of perQuestion) {
        if (entry.outcome === QuestionOutcome.UNANSWERED) {
            unattemptedCount += 1;
        } else if (entry.outcome === QuestionOutcome.CORRECT) {
            correct += 1;
        }
    }

    const attemptedCount = total - unattemptedCount;

    const accuracyPercent = attemptedCount > 0 ? (correct / attemptedCount) * 100 : 0;
    const attemptRate = total > 0 ? (attemptedCount / total) * 100 : 0;
    const averageTimePerQuestion =
        timeTakenSec != null && total > 0 ? timeTakenSec / total : null;

    return {
        accuracyPercent,
        averageTimePerQuestion,
        unattemptedCount,
        attemptRate,
    };
}
