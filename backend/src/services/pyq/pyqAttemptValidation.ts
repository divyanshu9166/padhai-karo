/**
 * Pure validation for the PYQ attempt submission endpoint (task 11.3; design "PYQ Practice
 * + Scoring Service"; Req 6.2, 6.3, 6.4, 6.5).
 *
 *   POST /api/pyq-attempts
 *     body: { paperOrSetRef, answers: [{ questionId, selectedOption? }], clientId? }
 *
 * Scoring happens server-side against the official answer key (resolved from the stored
 * PYQ rows, never from client input). This module holds only the framework- and
 * database-free decision logic that shapes/normalizes the request body so it can be
 * unit-tested in isolation and reused by the thin route handler. The answer-key assembly
 * and scoring orchestration live in {@link ./pyqAttemptService}; the numbered scoring
 * property test (Property 31) is task 11.4.
 *
 * Validation rules:
 *   - `paperOrSetRef` is a required non-blank string (identifies the practiced set).
 *   - `answers` is a required array. Each entry must carry a non-blank `questionId` and an
 *     optional `selectedOption`. A selected option, when present, must be an integer (the
 *     0-based index into the question's options, matching the stored `PYQ.correctOption`
 *     `Int`); a missing/null option means the question was left unanswered.
 *   - `clientId` is an optional offline-idempotency key (Req 21 seam), persisted as-is.
 *
 * Note the selected option is NEVER trusted as a correctness signal — it is only the user's
 * choice. The correct answer is always read from the database in the service layer.
 */

/** Raw, untrusted attempt input as received from the request body. */
export interface PyqAttemptInput {
    paperOrSetRef?: unknown;
    answers?: unknown;
    clientId?: unknown;
}

/** A single normalized answer ready to score/persist. */
export interface NormalizedAnswer {
    questionId: string;
    /** The selected option index, or null when the question was left unanswered. */
    selectedOption: number | null;
}

/** A validated, normalized attempt ready to score and persist. */
export interface ValidatedPyqAttempt {
    paperOrSetRef: string;
    answers: NormalizedAnswer[];
    clientId: string | null;
}

/** Discriminated result of {@link validatePyqAttemptInput}. */
export type PyqAttemptValidation =
    | { ok: true; value: ValidatedPyqAttempt }
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
 * Validate and normalize a PYQ attempt request (Req 6.2, 6.3, 6.4, 6.5).
 *
 * Checks, in order:
 *   1. `paperOrSetRef` is a non-blank string.
 *   2. `answers` is an array.
 *   3. each answer is an object with a non-blank `questionId` and an integer-or-absent
 *      `selectedOption`.
 *   4. `clientId`, when present, is a non-blank string (else normalized to null).
 *
 * Pure: performs no I/O and never touches the database, so the caller (the service/route
 * handler) owns answer-key resolution, scoring, persistence, and per-user scoping.
 */
export function validatePyqAttemptInput(input: PyqAttemptInput): PyqAttemptValidation {
    // 1. paperOrSetRef is required.
    if (typeof input.paperOrSetRef !== 'string' || input.paperOrSetRef.trim() === '') {
        return {
            ok: false,
            message: '"paperOrSetRef" is required.',
            details: { field: 'paperOrSetRef' },
        };
    }
    const paperOrSetRef = input.paperOrSetRef.trim();

    // 2. answers must be an array.
    if (!Array.isArray(input.answers)) {
        return {
            ok: false,
            message: '"answers" must be an array.',
            details: { field: 'answers' },
        };
    }

    // 3. each answer entry is validated and normalized.
    const answers: NormalizedAnswer[] = [];
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

    // 4. clientId is an optional offline-idempotency key (Req 21).
    const clientId =
        typeof input.clientId === 'string' && input.clientId.trim() !== ''
            ? input.clientId.trim()
            : null;

    return { ok: true, value: { paperOrSetRef, answers, clientId } };
}
