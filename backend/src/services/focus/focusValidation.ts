/**
 * Pure validation for the Focus Timer / Session Service (task 8.1; design "Focus Timer /
 * Session Service"; Req 4.3, 4.5, 4.7, 4.8).
 *
 * Timing happens on the Mobile_Client; the Backend_API validates and persists. This module
 * holds the framework- and database-free decision logic so it can be unit-tested in
 * isolation (no live DB required) and reused by the thin route handler:
 *
 *   - A subject is required (Req 4.3): a missing/blank `subjectId` is a validation error.
 *   - The recorded focused duration must be greater than zero AND not greater than the
 *     elapsed wall-clock minutes between `startTime` and `endTime` (Req 4.5).
 *   - `sessionType` defaults to `NEW_CHAPTER` when omitted (Req 4.8) and is otherwise
 *     persisted as provided (Req 4.7); an unrecognized value is a validation error.
 *
 * The numbered property tests for duration validity (Property 21) and session-type default
 * (Property 22) are separate tasks (8.3, 8.4) and are intentionally not implemented here.
 */
import type { SessionType } from '@prisma/client';

/** The Session_Type applied when the client records a session without tagging one (Req 4.8). */
export const DEFAULT_SESSION_TYPE: SessionType = 'NEW_CHAPTER';

/**
 * All valid {@link SessionType} values (Req 4.6). Declared explicitly so the validator can
 * reject unknown tags without a database round-trip; kept in sync with the Prisma enum.
 */
export const SESSION_TYPES: readonly SessionType[] = [
    'NEW_CHAPTER',
    'PRACTICE_PROBLEMS',
    'REVISION',
    'MOCK_ANALYSIS',
    'FORMULA_DRILL',
];

/** Raw, untrusted record-session input as received from the request body. */
export interface FocusSessionInput {
    subjectId?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    focusedDurationMin?: unknown;
    sessionType?: unknown;
    clientId?: unknown;
}

/** A validated, normalized focus session ready to persist. */
export interface ValidatedFocusSession {
    subjectId: string;
    startTime: Date;
    endTime: Date;
    focusedDurationMin: number;
    sessionType: SessionType;
    clientId: string | null;
}

/** Discriminated result of {@link validateFocusSessionInput}. */
export type FocusSessionValidation =
    | { ok: true; value: ValidatedFocusSession }
    | { ok: false; message: string; details?: Record<string, unknown> };

/**
 * Elapsed wall-clock minutes between two instants. Returns the exact (possibly fractional)
 * number of minutes so that an integer `focusedDurationMin` is compared against the true
 * elapsed span rather than a rounded one (Req 4.5). Negative when `end` precedes `start`.
 */
export function elapsedWallClockMinutes(start: Date, end: Date): number {
    return (end.getTime() - start.getTime()) / 60_000;
}

/**
 * Coerce an incoming timestamp (ISO string, epoch millis, or `Date`) into a valid `Date`,
 * or `null` when it cannot be parsed. Kept narrow on purpose: blank strings and `NaN`
 * dates are rejected rather than silently becoming the epoch or "now".
 */
function parseTimestamp(value: unknown): Date | null {
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

/**
 * Resolve the optional `sessionType` tag (Req 4.7/4.8). An omitted/null/undefined value
 * defaults to {@link DEFAULT_SESSION_TYPE}; a provided value must be one of
 * {@link SESSION_TYPES}; anything else is rejected.
 */
export function resolveSessionType(
    value: unknown,
): { ok: true; sessionType: SessionType } | { ok: false; message: string } {
    if (value === undefined || value === null || value === '') {
        return { ok: true, sessionType: DEFAULT_SESSION_TYPE };
    }
    if (typeof value === 'string' && (SESSION_TYPES as string[]).includes(value)) {
        return { ok: true, sessionType: value as SessionType };
    }
    return {
        ok: false,
        message: `"sessionType" must be one of: ${SESSION_TYPES.join(', ')}.`,
    };
}

/**
 * Validate and normalize a focus-session record request (Req 4.3, 4.5, 4.7, 4.8).
 *
 * Checks, in order:
 *   1. `subjectId` is a non-blank string (Req 4.3 — a subject is required).
 *   2. `startTime` and `endTime` are parseable timestamps.
 *   3. `focusedDurationMin` is a positive integer (Req 4.5 — strictly greater than zero).
 *   4. `focusedDurationMin` does not exceed the elapsed wall-clock minutes (Req 4.5).
 *   5. `sessionType` is valid or defaults to `NEW_CHAPTER` (Req 4.7/4.8).
 *
 * Pure: performs no I/O and never touches the database, so the caller (the route handler)
 * owns persistence and per-user scoping.
 */
export function validateFocusSessionInput(input: FocusSessionInput): FocusSessionValidation {
    // 1. Subject is required (Req 4.3).
    if (typeof input.subjectId !== 'string' || input.subjectId.trim() === '') {
        return {
            ok: false,
            message: 'A subject is required to record a focus session.',
            details: { field: 'subjectId' },
        };
    }
    const subjectId = input.subjectId.trim();

    // 2. Start/end must be valid timestamps.
    const startTime = parseTimestamp(input.startTime);
    if (startTime === null) {
        return {
            ok: false,
            message: '"startTime" must be a valid date-time.',
            details: { field: 'startTime' },
        };
    }
    const endTime = parseTimestamp(input.endTime);
    if (endTime === null) {
        return {
            ok: false,
            message: '"endTime" must be a valid date-time.',
            details: { field: 'endTime' },
        };
    }

    // 3. Focused duration must be a positive integer (Req 4.5: greater than zero).
    const { focusedDurationMin } = input;
    if (
        typeof focusedDurationMin !== 'number' ||
        !Number.isInteger(focusedDurationMin) ||
        focusedDurationMin <= 0
    ) {
        return {
            ok: false,
            message: '"focusedDurationMin" must be an integer greater than zero.',
            details: { field: 'focusedDurationMin' },
        };
    }

    // 4. Focused duration may not exceed the elapsed wall-clock span (Req 4.5).
    const elapsedMinutes = elapsedWallClockMinutes(startTime, endTime);
    if (focusedDurationMin > elapsedMinutes) {
        return {
            ok: false,
            message:
                '"focusedDurationMin" cannot exceed the elapsed wall-clock minutes between startTime and endTime.',
            details: { field: 'focusedDurationMin', focusedDurationMin, elapsedMinutes },
        };
    }

    // 5. Session type defaults to NEW_CHAPTER, else must be a known value (Req 4.7/4.8).
    const sessionTypeResult = resolveSessionType(input.sessionType);
    if (!sessionTypeResult.ok) {
        return {
            ok: false,
            message: sessionTypeResult.message,
            details: { field: 'sessionType' },
        };
    }

    // clientId is optional offline-idempotency key (Req 21); persisted as-is when present.
    const clientId =
        typeof input.clientId === 'string' && input.clientId.trim() !== ''
            ? input.clientId.trim()
            : null;

    return {
        ok: true,
        value: {
            subjectId,
            startTime,
            endTime,
            focusedDurationMin,
            sessionType: sessionTypeResult.sessionType,
            clientId,
        },
    };
}
