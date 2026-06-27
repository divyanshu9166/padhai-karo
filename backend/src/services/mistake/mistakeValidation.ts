/**
 * Pure validation for the Mistake Journal flag endpoint (task 14.1; design "Mistake Journal
 * Service" and "Mistake Journal Flagging"; Req 18.1, 18.2, 18.4).
 *
 *   POST /api/mistakes
 *     body: { sourceType: "PYQ"|"TIMED", attemptId, questionId, category, note?, explicitFlag? }
 *
 * This module holds ONLY the framework- and database-free decision logic that shapes and
 * normalizes the request body, so it can be unit-tested in isolation and reused by the thin
 * route handler. Attempt lookup, the flaggable decision, server-side resolution of the
 * correct/submitted answers, the upsert, and per-user scoping all live in the service layer
 * ({@link ./mistakeService}); the flaggable decision itself is the pure
 * {@link ./flagDecision} module. The numbered property tests (Properties 35–37) are tasks
 * 14.2–14.4.
 *
 * Validation rules:
 *   - `sourceType` is required and must be `"PYQ"` or `"TIMED"` (identifies which attempt
 *     table to load the referenced attempt from).
 *   - `attemptId` is a required non-blank string (the completed attempt the flag is sourced
 *     from).
 *   - `questionId` is a required non-blank string (the flagged question's reference).
 *   - `category` is REQUIRED and must be one of the four Mistake_Category values
 *     (`SILLY_MISTAKE`, `CONCEPT_GAP`, `TIME_PRESSURE`, `NEVER_SEEN_THIS`). A missing or
 *     invalid category is rejected `422` (Req 18.2).
 *   - `note` is an optional free-text string; blank/whitespace is normalized to `null`.
 *   - `explicitFlag` is an optional boolean (default `false`). It records that the user
 *     explicitly flagged the question during the attempt, which permits flagging even a
 *     correctly-answered question per Req 18.3 ("...and did not explicitly flag").
 *
 * The category list is mirrored here (rather than imported from the generated Prisma client)
 * so the module stays free of any database/runtime coupling and trivially testable, matching
 * the approach used by the pure scoring module.
 */

/** The four Mistake_Category values, mirroring the Prisma `MistakeCategory` enum (Req 18.2). */
export const MISTAKE_CATEGORIES = [
    'SILLY_MISTAKE',
    'CONCEPT_GAP',
    'TIME_PRESSURE',
    'NEVER_SEEN_THIS',
] as const;

export type MistakeCategoryValue = (typeof MISTAKE_CATEGORIES)[number];

/** The two source types, mirroring the `MistakeJournalEntry.sourceType` string contract. */
export const MISTAKE_SOURCE_TYPES = ['PYQ', 'TIMED'] as const;

export type MistakeSourceType = (typeof MISTAKE_SOURCE_TYPES)[number];

/** Raw, untrusted flag input as received from the request body. */
export interface MistakeFlagInput {
    sourceType?: unknown;
    attemptId?: unknown;
    questionId?: unknown;
    category?: unknown;
    note?: unknown;
    explicitFlag?: unknown;
}

/** A validated, normalized flag request ready for attempt lookup and upsert. */
export interface ValidatedMistakeFlag {
    sourceType: MistakeSourceType;
    attemptId: string;
    questionId: string;
    category: MistakeCategoryValue;
    note: string | null;
    explicitFlag: boolean;
}

/** Discriminated result of {@link validateMistakeFlagInput}. */
export type MistakeFlagValidation =
    | { ok: true; value: ValidatedMistakeFlag }
    | { ok: false; message: string; details?: Record<string, unknown> };

/** Type guard: is `value` one of the four valid Mistake_Category values? (Req 18.2) */
export function isMistakeCategory(value: unknown): value is MistakeCategoryValue {
    return (
        typeof value === 'string' &&
        (MISTAKE_CATEGORIES as readonly string[]).includes(value)
    );
}

/** Type guard: is `value` a valid source type (`"PYQ"` or `"TIMED"`)? */
export function isMistakeSourceType(value: unknown): value is MistakeSourceType {
    return (
        typeof value === 'string' &&
        (MISTAKE_SOURCE_TYPES as readonly string[]).includes(value)
    );
}

/**
 * Validate and normalize a Mistake Journal flag request (Req 18.1, 18.2, 18.4).
 *
 * Checks, in order:
 *   1. `sourceType` is `"PYQ"` or `"TIMED"`.
 *   2. `attemptId` is a non-blank string.
 *   3. `questionId` is a non-blank string.
 *   4. `category` is present and one of the four valid values (else `422`, Req 18.2).
 *   5. `note`, when present, must be a string (normalized to null when blank).
 *   6. `explicitFlag`, when present, must be a boolean (defaults to false).
 *
 * Pure: performs no I/O and never touches the database. Answer resolution and the
 * flaggable decision are the service layer's concern.
 */
export function validateMistakeFlagInput(input: MistakeFlagInput): MistakeFlagValidation {
    // 1. sourceType must be PYQ or TIMED.
    if (!isMistakeSourceType(input.sourceType)) {
        return {
            ok: false,
            message: '"sourceType" must be one of: PYQ, TIMED.',
            details: { field: 'sourceType' },
        };
    }
    const sourceType = input.sourceType;

    // 2. attemptId is required.
    if (typeof input.attemptId !== 'string' || input.attemptId.trim() === '') {
        return {
            ok: false,
            message: '"attemptId" is required.',
            details: { field: 'attemptId' },
        };
    }
    const attemptId = input.attemptId.trim();

    // 3. questionId is required.
    if (typeof input.questionId !== 'string' || input.questionId.trim() === '') {
        return {
            ok: false,
            message: '"questionId" is required.',
            details: { field: 'questionId' },
        };
    }
    const questionId = input.questionId.trim();

    // 4. category is REQUIRED and must be valid (Req 18.2).
    if (!isMistakeCategory(input.category)) {
        return {
            ok: false,
            message:
                '"category" is required and must be one of: SILLY_MISTAKE, CONCEPT_GAP, TIME_PRESSURE, NEVER_SEEN_THIS.',
            details: { field: 'category' },
        };
    }
    const category = input.category;

    // 5. note is optional free text; blank is normalized to null.
    let note: string | null = null;
    if (input.note !== undefined && input.note !== null) {
        if (typeof input.note !== 'string') {
            return {
                ok: false,
                message: '"note" must be a string.',
                details: { field: 'note' },
            };
        }
        note = input.note.trim() === '' ? null : input.note.trim();
    }

    // 6. explicitFlag is optional boolean (default false).
    let explicitFlag = false;
    if (input.explicitFlag !== undefined && input.explicitFlag !== null) {
        if (typeof input.explicitFlag !== 'boolean') {
            return {
                ok: false,
                message: '"explicitFlag" must be a boolean.',
                details: { field: 'explicitFlag' },
            };
        }
        explicitFlag = input.explicitFlag;
    }

    return {
        ok: true,
        value: { sourceType, attemptId, questionId, category, note, explicitFlag },
    };
}

/**
 * Validate an optional `category` query-string filter for `GET /api/mistakes` (Req 18.6).
 * Returns the concrete category when present and valid, `null` when absent, or an `ok:false`
 * result when present but not a valid Mistake_Category.
 */
export function validateCategoryFilter(
    raw: string | null,
): { ok: true; value: MistakeCategoryValue | null } | { ok: false; message: string } {
    if (raw === null || raw === '') {
        return { ok: true, value: null };
    }
    if (!isMistakeCategory(raw)) {
        return {
            ok: false,
            message:
                '"category" must be one of: SILLY_MISTAKE, CONCEPT_GAP, TIME_PRESSURE, NEVER_SEEN_THIS.',
        };
    }
    return { ok: true, value: raw };
}
