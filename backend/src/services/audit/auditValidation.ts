/**
 * Pure validation for the Daily Time Audit Service (task 10.1; design "Daily Time Audit /
 * Study Velocity Service"; Req 14.1).
 *
 * The check-in endpoint accepts `{ date, plannedMin, actualMin? }`. This module holds the
 * framework- and database-free validation so it can be unit-tested in isolation and reused
 * by the thin route handler:
 *
 *   - `date` must be a parseable calendar date (ISO string, epoch millis, or `Date`); an
 *     unparseable/blank value is a 422 validation error.
 *   - `plannedMin` must be a non-negative integer (Req 14.1 — the planned study time for the
 *     day). A missing/negative/fractional value is a 422 validation error.
 *   - `actualMin` is optional. When provided it must be a non-negative integer; the handler
 *     uses it only as the fallback when the day has no Focus_Sessions (Req 14.3). An invalid
 *     provided value is a 422 validation error rather than being silently dropped.
 *
 * Pure: performs no I/O and never touches the database, so the caller owns day-boundary
 * normalization, the focus-session lookup, persistence, and per-user scoping.
 */

/** Raw, untrusted daily-audit input as received from the request body. */
export interface DailyAuditInput {
    date?: unknown;
    plannedMin?: unknown;
    actualMin?: unknown;
}

/** A validated, normalized daily-audit check-in ready to persist. */
export interface ValidatedDailyAudit {
    /** The parsed instant identifying the audited day (handler normalizes to the UTC day). */
    date: Date;
    /** Planned study minutes for the day (non-negative integer). */
    plannedMin: number;
    /** User-entered actual minutes, or `null` when none was supplied (Req 14.3 fallback). */
    userEnteredActual: number | null;
}

/** Discriminated result of {@link validateDailyAuditInput}. */
export type DailyAuditValidation =
    | { ok: true; value: ValidatedDailyAudit }
    | { ok: false; message: string; details?: Record<string, unknown> };

/**
 * Coerce an incoming date (ISO string, epoch millis, or `Date`) into a valid `Date`, or
 * `null` when it cannot be parsed. Blank strings and `NaN` dates are rejected rather than
 * silently becoming the epoch or "now".
 */
export function parseDate(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

/** True when `value` is a non-negative integer (minutes can be zero but never negative). */
function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Validate and normalize a daily check-in request (Req 14.1).
 *
 * Checks, in order:
 *   1. `date` parses to a valid calendar date.
 *   2. `plannedMin` is a non-negative integer.
 *   3. `actualMin`, when present, is a non-negative integer; absent leaves it `null`.
 *
 * Pure: no I/O.
 */
export function validateDailyAuditInput(input: DailyAuditInput): DailyAuditValidation {
    // 1. Date must be a valid calendar date.
    const date = parseDate(input.date);
    if (date === null) {
        return {
            ok: false,
            message: '"date" must be a valid date.',
            details: { field: 'date' },
        };
    }

    // 2. Planned minutes must be a non-negative integer (Req 14.1).
    if (!isNonNegativeInteger(input.plannedMin)) {
        return {
            ok: false,
            message: '"plannedMin" must be a non-negative integer.',
            details: { field: 'plannedMin' },
        };
    }

    // 3. Actual minutes are optional; when present they must be a non-negative integer.
    let userEnteredActual: number | null = null;
    if (input.actualMin !== undefined && input.actualMin !== null) {
        if (!isNonNegativeInteger(input.actualMin)) {
            return {
                ok: false,
                message: '"actualMin" must be a non-negative integer when provided.',
                details: { field: 'actualMin' },
            };
        }
        userEnteredActual = input.actualMin;
    }

    return {
        ok: true,
        value: { date, plannedMin: input.plannedMin, userEnteredActual },
    };
}
