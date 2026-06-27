/**
 * Pure validation for the Timed Paper Mode attempt submission endpoint (task 13.1; design
 * "Timed Paper Mode Service"; Req 19.5, 19.6, 19.7).
 *
 *   POST /api/timed-attempts
 *     body: { paperId, answers: [{ questionId, selectedOption? }], timeTakenSec, clientId? }
 *
 * As with PYQ practice (task 11.3), scoring happens SERVER-SIDE against the official answer
 * key — assembled from the paper's stored PYQ rows, never from client input. This module
 * holds only the framework- and database-free decision logic that shapes/normalizes the
 * request body so it can be unit-tested in isolation and reused by the thin route handler.
 * The answer-key assembly and scoring orchestration live in
 * {@link ./timedPaperAttemptService}; the numbered journal-eligibility property test
 * (Property 38) is task 13.2.
 *
 * Validation rules:
 *   - `paperId` is a required non-blank string (identifies the PYQ_Paper attempted).
 *   - `answers` is a required array. Each entry must carry a non-blank `questionId` and an
 *     optional `selectedOption`. A selected option, when present, must be an integer (the
 *     0-based index into the question's options, matching the stored `PYQ.correctOption`
 *     `Int`); a missing/null option means the question was left unanswered. Because timed
 *     scoring covers EVERY question of the paper (Req 19.5), questions the user never
 *     reached may simply be omitted from `answers` — the service scores them `UNANSWERED`.
 *   - `timeTakenSec` is a required non-negative integer (seconds elapsed in the session).
 *   - `clientId` is an optional offline-idempotency key (Req 21 seam), persisted as-is.
 *
 * The selected option is NEVER trusted as a correctness signal — it is only the user's
 * choice. The correct answer is always read from the database in the service layer.
 */

/** Raw, untrusted attempt input as received from the request body. */
export interface TimedAttemptInput {
    paperId?: unknown;
    answers?: unknown;
    timeTakenSec?: unknown;
    clientId?: unknown;
}

/** A single normalized answer ready to score/persist. */
export interface NormalizedTimedAnswer {
    questionId: string;
    /** The selected option index, or null when the question was left unanswered. */
    selectedOption: number | null;
}

/** A validated, normalized timed-paper attempt ready to score and persist. */
export interface ValidatedTimedAttempt {
    paperId: string;
    answers: NormalizedTimedAnswer[];
    timeTakenSec: number;
    clientId: string | null;
}

/** Discriminated result of {@link validateTimedAttemptInput}. */
export type TimedAttemptValidation =
    | { ok: true; value: ValidatedTimedAttempt }
    | { ok: false; message: string; details?: Record<string, unknown> };

/**
 * Normalize a single answer's `selectedOption`. Returns `{ ok: true, value }` with a
 * concrete integer or null, or `{ ok: false }` when the value is present but not an
 * integer. Missing/null/undefined is normalized to `null` (unanswered).
 */
function normalizeSelectedOption(
    value: unknown,
): { ok: true; value: number | null } | { ok: false } {
    if (value === undefined || value === null) {
        return { ok: true, value: null };
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
        return { ok: true, value };
    }
    return { ok: false };
}

/**
 * Validate and normalize a timed-paper attempt request (Req 19.5, 19.6, 19.7).
 *
 * Checks, in order:
 *   1. `paperId` is a non-blank string.
 *   2. `answers` is an array.
 *   3. each answer is an object with a non-blank `questionId` and an integer-or-absent
 *      `selectedOption`.
 *   4. `timeTakenSec` is a non-negative integer.
 *   5. `clientId`, when present, is a non-blank string (else normalized to null).
 *
 * Pure: performs no I/O and never touches the database, so the caller (the service/route
 * handler) owns answer-key resolution, scoring, persistence, and per-user scoping.
 */
export function validateTimedAttemptInput(input: TimedAttemptInput): TimedAttemptValidation {
    // 1. paperId is required.
    if (typeof input.paperId !== 'string' || input.paperId.trim() === '') {
        return {
            ok: false,
            message: '"paperId" is required.',
            details: { field: 'paperId' },
        };
    }
    const paperId = input.paperId.trim();

    // 2. answers must be an array.
    if (!Array.isArray(input.answers)) {
        return {
            ok: false,
            message: '"answers" must be an array.',
            details: { field: 'answers' },
        };
    }

    // 3. each answer entry is validated and normalized.
    const answers: NormalizedTimedAnswer[] = [];
    for (let i = 0; i < input.answers.length; i += 1) {
        const entry = input.answers[i] as unknown;
        if (typeof entry !== 'object' || entry === null) {
            return {
                ok: false,
                message: `"answers[${i}]" must be an object.`,
                details: { field: `answers[${i}]` },
            };
        }
        const { questionId, selectedOption } = entry as {
            questionId?: unknown;
            selectedOption?: unknown;
        };

        if (typeof questionId !== 'string' || questionId.trim() === '') {
            return {
                ok: false,
                message: `"answers[${i}].questionId" is required.`,
                details: { field: `answers[${i}].questionId` },
            };
        }

        const normalizedOption = normalizeSelectedOption(selectedOption);
        if (!normalizedOption.ok) {
            return {
                ok: false,
                message: `"answers[${i}].selectedOption" must be an integer or omitted.`,
                details: { field: `answers[${i}].selectedOption` },
            };
        }

        answers.push({ questionId: questionId.trim(), selectedOption: normalizedOption.value });
    }

    // 4. timeTakenSec must be a non-negative integer.
    if (
        typeof input.timeTakenSec !== 'number' ||
        !Number.isInteger(input.timeTakenSec) ||
        input.timeTakenSec < 0
    ) {
        return {
            ok: false,
            message: '"timeTakenSec" must be a non-negative integer.',
            details: { field: 'timeTakenSec' },
        };
    }
    const timeTakenSec = input.timeTakenSec;

    // 5. clientId is an optional offline-idempotency key (Req 21).
    const clientId =
        typeof input.clientId === 'string' && input.clientId.trim() !== ''
            ? input.clientId.trim()
            : null;

    return { ok: true, value: { paperId, answers, timeTakenSec, clientId } };
}
