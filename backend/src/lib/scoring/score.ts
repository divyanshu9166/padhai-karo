/**
 * Pure PYQ / Timed-Paper scoring logic (Req 6.2–6.4, 19.5–19.6).
 *
 * This module is intentionally free of any database, Prisma, or framework
 * dependencies so it is a trivially testable pure function of
 * `(answers, answerKey)`. It is shared by PYQ practice (task 11.3) and Timed
 * Paper Mode (task 13.1).
 *
 * Scoring rules:
 * - A question is `CORRECT` when the selected option matches the answer key.
 * - A question is `UNANSWERED` when no option was selected (null/undefined, or
 *   the question was never reached and is therefore absent from `answers`).
 * - A question is `INCORRECT` otherwise.
 * - `totalScore` is the count of `CORRECT` outcomes; unanswered questions never
 *   match the key and so never count toward the score while remaining labeled
 *   `UNANSWERED`.
 *
 * The answer key defines the full set of questions to score. Timed-paper
 * scoring therefore covers EVERY question of the paper — including questions the
 * user never reached — because those simply do not appear in `answers` and are
 * scored `UNANSWERED` (Req 19.5/19.6).
 */

/**
 * Per-question outcome. Values intentionally mirror the Prisma `QuestionOutcome`
 * enum (CORRECT, INCORRECT, UNANSWERED) so callers can persist them directly,
 * without importing the generated Prisma client into this pure module.
 */
export const QuestionOutcome = {
    CORRECT: 'CORRECT',
    INCORRECT: 'INCORRECT',
    UNANSWERED: 'UNANSWERED',
} as const;

export type QuestionOutcome = (typeof QuestionOutcome)[keyof typeof QuestionOutcome];

/** One question's entry in the official answer key: its id and correct option. */
export interface AnswerKeyEntry {
    questionId: string;
    correctOption: string;
}

/** One recorded answer: the question id and the option the user selected (if any). */
export interface AnswerInput {
    questionId: string;
    /** The selected option, or null/undefined when the question was not answered. */
    selectedOption?: string | null;
}

/** The graded result for a single question. */
export interface PerQuestionResult {
    questionId: string;
    /** The option the user selected, normalized to null when unanswered. */
    selectedOption: string | null;
    correctOption: string;
    outcome: QuestionOutcome;
}

/** The full scoring result for an attempt. */
export interface ScoreResult {
    perQuestion: PerQuestionResult[];
    totalScore: number;
}

/** Normalize a possibly-absent option to either a concrete value or null. */
function normalizeOption(option: string | null | undefined): string | null {
    return option === undefined || option === null ? null : option;
}

/** Classify a single question given its (normalized) selection and correct option. */
function classifyOutcome(selectedOption: string | null, correctOption: string): QuestionOutcome {
    if (selectedOption === null) {
        return QuestionOutcome.UNANSWERED;
    }
    return selectedOption === correctOption ? QuestionOutcome.CORRECT : QuestionOutcome.INCORRECT;
}

/**
 * Score a set of answers against an answer key.
 *
 * Iterates over the answer key's full set of questions (in key order) so that
 * any question missing from `answers` — e.g. never reached in a timed paper — is
 * scored `UNANSWERED`. Answers for questions not present in the key are ignored.
 * When the same question id appears more than once in `answers`, the last
 * occurrence wins.
 *
 * @param answers   The recorded answers (a list of question id -> selected option).
 * @param answerKey The official answer key (the full set of questions to score).
 * @returns The per-question outcomes (in answer-key order) and the total score.
 */
export function scoreAttempt(
    answers: ReadonlyArray<AnswerInput>,
    answerKey: ReadonlyArray<AnswerKeyEntry>,
): ScoreResult {
    const selectedByQuestion = new Map<string, string | null>();
    for (const answer of answers) {
        selectedByQuestion.set(answer.questionId, normalizeOption(answer.selectedOption));
    }

    const perQuestion: PerQuestionResult[] = answerKey.map((entry) => {
        const selectedOption = selectedByQuestion.has(entry.questionId)
            ? (selectedByQuestion.get(entry.questionId) as string | null)
            : null;
        return {
            questionId: entry.questionId,
            selectedOption,
            correctOption: entry.correctOption,
            outcome: classifyOutcome(selectedOption, entry.correctOption),
        };
    });

    const totalScore = perQuestion.reduce(
        (count, result) => (result.outcome === QuestionOutcome.CORRECT ? count + 1 : count),
        0,
    );

    return { perQuestion, totalScore };
}
