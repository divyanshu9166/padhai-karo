/**
 * Pure validation for the External Mock Score endpoints (task 4.1; design "External Mock
 * Score endpoints (Req 1)"; Req 1.2, 1.3, 1.4).
 *
 *   POST  /api/analytics/mock-scores       body: { source, sourceName?, testDate, obtainedScore, maxScore }
 *   PATCH /api/analytics/mock-scores/:id    body: { source?, sourceName?, testDate?, obtainedScore?, maxScore? }
 *
 * This module holds only the framework- and database-free decision logic that validates and
 * normalizes a candidate External_Mock_Score so it can be unit/property-tested in isolation
 * (no live DB required) and reused by the thin persistence handler. It mirrors the Phase 1
 * pure-validator convention (see {@link ../profile/profileValidation} and
 * {@link ../timedPaper/timedPaperValidation}): a validator returns a discriminated result
 * `{ ok: true, value }` or `{ ok: false, message, details }`, never throwing and never
 * performing I/O. The route/service layer maps an `ok: false` result onto the Phase 1 error
 * envelope as `errorResponse(422, ErrorCode.VALIDATION_ERROR, message, details)`, with
 * `details.field` naming the offending field.
 *
 * Acceptance criteria enforced (Req 1.2–1.4 plus the OTHER-source label rule from the design):
 *   - `source` is one of {@link MOCK_SERIES_SOURCE_VALUES} (ALLEN / AAKASH / OTHER).
 *   - WHERE `source = OTHER`, `sourceName` is a required non-blank label.
 *   - `maxScore` is a number `> 0` (Req 1.3).
 *   - `obtainedScore` is a number with `0 <= obtainedScore <= maxScore` (Req 1.2).
 *   - `testDate` is a valid date that is not later than `now` (Req 1.4); `now` is injectable
 *     for testability and defaults to `new Date()`.
 *
 * For edits (Req 1.5) the handler merges the patch onto the persisted record and re-runs this
 * same validator against the merged candidate, so editing obeys identical rules to creation.
 */

/** The supported Mock_Series_Source values (mirrors the Prisma `MockSeriesSource` enum). */
export const MOCK_SERIES_SOURCE_VALUES = ['ALLEN', 'AAKASH', 'OTHER'] as const;

/** A named provider of an External_Mock_Score. */
export type MockSeriesSource = (typeof MOCK_SERIES_SOURCE_VALUES)[number];

/** Raw, untrusted external-mock-score input as received from the request body. */
export interface MockScoreInput {
    source?: unknown;
    sourceName?: unknown;
    testDate?: unknown;
    obtainedScore?: unknown;
    maxScore?: unknown;
}

/** A validated, normalized External_Mock_Score ready to persist. */
export interface ValidatedMockScore {
    source: MockSeriesSource;
    /** Non-blank label when `source = OTHER`; `null` for the named providers. */
    sourceName: string | null;
    testDate: Date;
    obtainedScore: number;
    maxScore: number;
}

/**
 * Discriminated validation result: either the parsed value or a ready-to-serialize
 * validation error (developer-facing `message` and structured `details` naming the field).
 */
export type MockScoreValidation =
    | { ok: true; value: ValidatedMockScore }
    | { ok: false; message: string; details: { field: string;[key: string]: unknown } };

/** Type guard: a finite number (rejects NaN, ±Infinity, and non-number types). */
function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Coerce a raw `testDate` into a concrete `Date`. Accepts a `Date` instance or a value that
 * `new Date(...)` parses to a valid time (ISO string or epoch millis). Returns `null` when
 * the value is absent or does not denote a valid date.
 */
function coerceDate(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

/**
 * Validate and normalize a candidate External_Mock_Score (Req 1.2, 1.3, 1.4).
 *
 * Checks, in order, returning the first violation as a `VALIDATION_ERROR` whose
 * `details.field` names the offending field:
 *   1. `source` is one of ALLEN / AAKASH / OTHER.
 *   2. when `source = OTHER`, `sourceName` is a non-blank string.
 *   3. `maxScore` is a finite number `> 0` (Req 1.3).
 *   4. `obtainedScore` is a finite number with `0 <= obtainedScore <= maxScore` (Req 1.2).
 *   5. `testDate` is a valid date that is `<= now` (Req 1.4).
 *
 * Pure: performs no I/O and never touches the database, so the caller owns persistence and
 * per-user scoping. `now` is injected for deterministic testing and defaults to the current
 * instant.
 */
export function validateMockScoreInput(
    input: MockScoreInput,
    now: Date = new Date(),
): MockScoreValidation {
    // 1. source must be one of the supported providers.
    if (
        typeof input.source !== 'string' ||
        !(MOCK_SERIES_SOURCE_VALUES as readonly string[]).includes(input.source)
    ) {
        return {
            ok: false,
            message: `"source" must be one of: ${MOCK_SERIES_SOURCE_VALUES.join(', ')}.`,
            details: { field: 'source', allowed: MOCK_SERIES_SOURCE_VALUES },
        };
    }
    const source = input.source as MockSeriesSource;

    // 2. when source = OTHER, a non-blank free-text label is required.
    let sourceName: string | null = null;
    if (source === 'OTHER') {
        if (typeof input.sourceName !== 'string' || input.sourceName.trim() === '') {
            return {
                ok: false,
                message: '"sourceName" is required and must be non-blank when "source" is OTHER.',
                details: { field: 'sourceName' },
            };
        }
        sourceName = input.sourceName.trim();
    }

    // 3. maxScore must be a finite number greater than zero (Req 1.3).
    if (!isFiniteNumber(input.maxScore) || input.maxScore <= 0) {
        return {
            ok: false,
            message: '"maxScore" must be a number greater than zero.',
            details: { field: 'maxScore' },
        };
    }
    const maxScore = input.maxScore;

    // 4. obtainedScore must be a finite number within [0, maxScore] (Req 1.2).
    if (!isFiniteNumber(input.obtainedScore)) {
        return {
            ok: false,
            message: '"obtainedScore" must be a number.',
            details: { field: 'obtainedScore' },
        };
    }
    if (input.obtainedScore < 0 || input.obtainedScore > maxScore) {
        return {
            ok: false,
            message: '"obtainedScore" must be between 0 and "maxScore" (inclusive).',
            details: { field: 'obtainedScore', maxScore },
        };
    }
    const obtainedScore = input.obtainedScore;

    // 5. testDate must be a valid date that is not later than now (Req 1.4).
    const testDate = coerceDate(input.testDate);
    if (testDate === null) {
        return {
            ok: false,
            message: '"testDate" must be a valid date.',
            details: { field: 'testDate' },
        };
    }
    if (testDate.getTime() > now.getTime()) {
        return {
            ok: false,
            message: '"testDate" must not be later than the current date.',
            details: { field: 'testDate' },
        };
    }

    return { ok: true, value: { source, sourceName, testDate, obtainedScore, maxScore } };
}
