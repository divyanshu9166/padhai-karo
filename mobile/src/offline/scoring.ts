/**
 * Pure local scoring for downloaded papers (task 21.9; Req 21.2).
 *
 * While offline the device must show instant per-question results for a downloaded paper, so
 * this module re-derives the score from the {@link PaperBundle}'s bundled Answer_Key without
 * any network call. It mirrors the Backend_API scoring contract exactly (design "PYQ Practice
 * + Scoring Service"; Req 6.2–6.4):
 *
 *   - CORRECT    — the selected option matches the key.
 *   - UNANSWERED — no option was selected (counts as not correct, but is labelled distinctly).
 *   - INCORRECT  — an option was selected and it does not match the key.
 *   - totalScore — the count of CORRECT questions.
 *
 * This is a deliberately dependency-free pure function (no React, no storage, no `fetch`) so it
 * is unit-testable without a device. The authoritative score is always recomputed server-side
 * when the queued attempt is later synced (Req 21.5); this local result is for offline display
 * only and never overrides the server's.
 */

import type { PaperBundle } from '@/api';

/** A per-question outcome, matching the practice screens' contract. */
export type LocalOutcome = 'CORRECT' | 'INCORRECT' | 'UNANSWERED';

/** One graded question. Option indices are stringified 0-based, matching the wire result. */
export interface LocalPerQuestion {
    questionId: string;
    /** The stringified selected option index, or `null` when unanswered. */
    selectedOption: string | null;
    /** The stringified correct option index from the bundled key. */
    correctOption: string;
    outcome: LocalOutcome;
}

/** The locally computed attempt result for a downloaded paper. */
export interface LocalAttemptResult {
    totalScore: number;
    perQuestion: LocalPerQuestion[];
}

/**
 * Resolve the correct option index for a question from the bundle. Prefers the official
 * Answer_Key entry (keyed by question id); falls back to the question's own `correctOption`
 * when the key has no entry for it.
 */
function correctOptionFor(bundle: PaperBundle, questionId: string, fallback: number): number {
    const entry = bundle.answerKey.entries[questionId];
    return typeof entry === 'number' ? entry : fallback;
}

/**
 * Score a set of answers against a downloaded {@link PaperBundle}. Every question on the paper
 * is graded (a missing answer is treated as UNANSWERED), so the result always covers the full
 * paper regardless of how many questions the user actually answered.
 *
 * @param bundle  the downloaded paper + answer key.
 * @param answers map of questionId → selected option index (or `null`/absent when unanswered).
 */
export function scoreBundle(
    bundle: PaperBundle,
    answers: Readonly<Record<string, number | null | undefined>>,
): LocalAttemptResult {
    let totalScore = 0;

    const perQuestion = bundle.paper.questions.map((question): LocalPerQuestion => {
        const selected = answers[question.id];
        const correct = correctOptionFor(bundle, question.id, question.correctOption);

        let outcome: LocalOutcome;
        if (selected === null || selected === undefined) {
            outcome = 'UNANSWERED';
        } else if (selected === correct) {
            outcome = 'CORRECT';
            totalScore += 1;
        } else {
            outcome = 'INCORRECT';
        }

        return {
            questionId: question.id,
            selectedOption: selected === null || selected === undefined ? null : String(selected),
            correctOption: String(correct),
            outcome,
        };
    });

    return { totalScore, perQuestion };
}
