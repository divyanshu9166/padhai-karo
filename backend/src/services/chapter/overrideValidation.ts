/**
 * Chapter override request validation: pure, reusable input checks (task 5.2; design
 * "Chapter / Syllabus Tracking Service"; Req 11.3, 11.4).
 *
 * The override endpoint lets a User replace a Chapter's weightage-driven allocation with an
 * explicit value (Req 11.3). This module captures the body-validation rule as a single pure
 * function so it is unit-testable without a database or framework and reusable by both the
 * handler and any future property test.
 *
 * `PATCH /api/chapters/:id/override` accepts a JSON object with any subset of the three
 * optional override fields:
 *
 *   - `weightageOverride`      replaces effective Chapter_Weightage allocation
 *   - `estHoursOverride`       replaces Estimated_Study_Hours used for scheduling
 *   - `timeAllocationOverride` replaces the directly-allocated study time
 *
 * Validation decisions (documented for task 5.2):
 *   - Every PROVIDED field MUST be a positive, finite number (strictly greater than zero).
 *     A zero, negative, non-finite (NaN/Infinity), or non-number value is rejected (422).
 *   - At least ONE of the three fields MUST be provided; an empty patch has nothing to
 *     persist and is rejected (422) rather than silently succeeding.
 *   - Fields that are absent (`undefined`) are simply not part of the update — this is how
 *     partial overrides work. Clearing overrides is the separate DELETE endpoint (Req 11.4),
 *     so `null` is NOT an accepted "clear this one field" value here and is rejected.
 *   - Unknown extra keys are ignored.
 */

/** The override columns a PATCH may set, all optional and all positive numbers when present. */
export interface ChapterOverrideInput {
    weightageOverride?: number;
    estHoursOverride?: number;
    timeAllocationOverride?: number;
}

/** Discriminated result of {@link validateChapterOverrideInput}. */
export type ChapterOverrideValidation =
    | { ok: true; value: ChapterOverrideInput }
    | { ok: false; message: string; details?: unknown };

/** The three keys an override patch may carry, in a stable order for deterministic errors. */
const OVERRIDE_FIELDS = [
    'weightageOverride',
    'estHoursOverride',
    'timeAllocationOverride',
] as const;

/** Is `value` a positive, finite number (strictly > 0)? Rejects NaN, Infinity, and non-numbers. */
function isPositiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validate the body of `PATCH /api/chapters/:id/override`.
 *
 * Returns `{ ok: true, value }` carrying only the provided, validated override fields, or
 * `{ ok: false, message, details }` describing the first failure. Pure: no I/O, total over
 * all inputs.
 */
export function validateChapterOverrideInput(body: unknown): ChapterOverrideValidation {
    if (typeof body !== 'object' || body === null) {
        return { ok: false, message: 'Request body must be a JSON object.' };
    }

    const record = body as Record<string, unknown>;
    const value: ChapterOverrideInput = {};

    for (const field of OVERRIDE_FIELDS) {
        const raw = record[field];
        if (raw === undefined) {
            continue;
        }
        if (!isPositiveNumber(raw)) {
            return {
                ok: false,
                message: `"${field}" must be a positive number.`,
                details: { field },
            };
        }
        value[field] = raw;
    }

    if (Object.keys(value).length === 0) {
        return {
            ok: false,
            message:
                'At least one override field (weightageOverride, estHoursOverride, or ' +
                'timeAllocationOverride) must be provided.',
        };
    }

    return { ok: true, value };
}
