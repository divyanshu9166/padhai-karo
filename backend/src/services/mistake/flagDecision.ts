/**
 * Pure "is this question flaggable?" decision for the Mistake Journal (task 14.1; design
 * "Mistake Journal Flagging", Req 18.3).
 *
 * A flag is accepted only if the question was answered **incorrectly** (or left unanswered,
 * which scoring counts as incorrect) in the referenced attempt, **OR** the user explicitly
 * flagged it. Flagging a correctly-answered, unflagged question is rejected `422` (Req 18.3).
 *
 * This module is intentionally free of any database/framework dependency: it operates on the
 * already-loaded `perQuestion` JSON of an attempt so it is trivially unit-testable. The
 * service layer ({@link ./mistakeService}) loads the attempt, calls {@link findPerQuestion}
 * to locate the question's record, then {@link decideFlaggable} to decide.
 *
 * ## perQuestion shape relied upon
 *
 * Both `PYQAttempt.perQuestion` and `TimedPaperAttempt.perQuestion` are JSON arrays produced
 * by the shared scoring function (`PerQuestionResult`), so each element has at minimum:
 *
 *   { questionId: string, outcome: "CORRECT" | "INCORRECT" | "UNANSWERED" }
 *
 * and, when written by the scoring function, also `selectedOption: string | null` and
 * `correctOption: string`. This module depends only on `questionId` and `outcome`; the
 * `selectedOption` field is consumed (best-effort) by the service to resolve the user's
 * submitted answer. Unknown/malformed elements are ignored defensively.
 */

/** Outcome labels, mirroring the scoring module / Prisma `QuestionOutcome` enum. */
export const QuestionOutcome = {
    CORRECT: 'CORRECT',
    INCORRECT: 'INCORRECT',
    UNANSWERED: 'UNANSWERED',
} as const;

export type QuestionOutcome = (typeof QuestionOutcome)[keyof typeof QuestionOutcome];

/** One question's record as read from a stored attempt's `perQuestion` JSON. */
export interface PerQuestionRecord {
    questionId: string;
    outcome: QuestionOutcome;
    /** The user's selected option (stringified index) when the scoring function recorded it. */
    selectedOption?: string | null;
}

/** Discriminated result of {@link decideFlaggable}. */
export type FlagDecision =
    | { allowed: true; outcome: QuestionOutcome }
    | { allowed: false; reason: 'NOT_IN_ATTEMPT' | 'CORRECT_NOT_FLAGGED' };

/** Narrow an arbitrary value to a known outcome label, else `null`. */
function toOutcome(value: unknown): QuestionOutcome | null {
    if (
        value === QuestionOutcome.CORRECT ||
        value === QuestionOutcome.INCORRECT ||
        value === QuestionOutcome.UNANSWERED
    ) {
        return value;
    }
    return null;
}

/**
 * Defensively parse a stored `perQuestion` JSON value into a list of records. Non-arrays
 * yield `[]`; elements that are not objects, lack a string `questionId`, or carry an
 * unrecognized `outcome` are skipped. This keeps the decision robust against malformed or
 * legacy attempt rows.
 */
export function readPerQuestion(json: unknown): PerQuestionRecord[] {
    if (!Array.isArray(json)) {
        return [];
    }
    const records: PerQuestionRecord[] = [];
    for (const element of json) {
        if (typeof element !== 'object' || element === null) {
            continue;
        }
        const { questionId, outcome, selectedOption } = element as {
            questionId?: unknown;
            outcome?: unknown;
            selectedOption?: unknown;
        };
        if (typeof questionId !== 'string') {
            continue;
        }
        const normalizedOutcome = toOutcome(outcome);
        if (normalizedOutcome === null) {
            continue;
        }
        const record: PerQuestionRecord = { questionId, outcome: normalizedOutcome };
        if (typeof selectedOption === 'string') {
            record.selectedOption = selectedOption;
        } else if (selectedOption === null) {
            record.selectedOption = null;
        }
        records.push(record);
    }
    return records;
}

/**
 * Locate a question's record within an attempt's parsed `perQuestion` list. Returns `null`
 * when the question is not part of the attempt.
 */
export function findPerQuestion(
    perQuestion: ReadonlyArray<PerQuestionRecord>,
    questionId: string,
): PerQuestionRecord | null {
    return perQuestion.find((record) => record.questionId === questionId) ?? null;
}

/**
 * Decide whether a question may be flagged into the Mistake Journal (Req 18.3).
 *
 * Rules:
 *   - The question must be part of the referenced attempt. A `null` record (question not in
 *     the attempt) is rejected with `NOT_IN_ATTEMPT`.
 *   - When `explicitFlag` is true, flagging is always allowed (the user explicitly flagged
 *     the question), regardless of outcome.
 *   - Otherwise, flagging is allowed only when the outcome is `INCORRECT` or `UNANSWERED`.
 *     A `CORRECT` outcome that was not explicitly flagged is rejected with
 *     `CORRECT_NOT_FLAGGED` (Req 18.3).
 *
 * @param record       the question's record from the attempt (or null if absent).
 * @param explicitFlag whether the request explicitly flagged the question.
 */
export function decideFlaggable(
    record: PerQuestionRecord | null,
    explicitFlag: boolean,
): FlagDecision {
    if (record === null) {
        return { allowed: false, reason: 'NOT_IN_ATTEMPT' };
    }
    if (explicitFlag) {
        return { allowed: true, outcome: record.outcome };
    }
    if (record.outcome === QuestionOutcome.CORRECT) {
        return { allowed: false, reason: 'CORRECT_NOT_FLAGGED' };
    }
    return { allowed: true, outcome: record.outcome };
}

/**
 * Resolve the user's submitted answer (a 0-based option index) from a question's attempt
 * record, server-side. Returns the integer index when the scoring function recorded a
 * concrete `selectedOption`, or `null` when the question was left unanswered / no selection
 * was recorded.
 */
export function resolveSubmittedAnswer(record: PerQuestionRecord): number | null {
    const selected = record.selectedOption;
    if (selected === undefined || selected === null) {
        return null;
    }
    const parsed = Number(selected);
    return Number.isInteger(parsed) ? parsed : null;
}
