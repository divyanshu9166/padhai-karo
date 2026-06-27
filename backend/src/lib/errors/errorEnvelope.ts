/**
 * Shared JSON error envelope.
 *
 * Per the design "Error Handling" section, every failure response uses a consistent
 * envelope shape: `{ error: { code, message, details? } }`. `code` is a stable string
 * the client maps to a localized message; `message` is a developer-facing fallback;
 * `details` is optional structured context (e.g. the unmet password requirement).
 */

/**
 * Stable, client-facing error codes. These strings are part of the API contract and
 * MUST remain stable: the Mobile_Client maps them to localized messages. Add new codes
 * here as features land rather than inventing ad-hoc strings at call sites.
 */
export const ErrorCode = {
    // Validation (HTTP 422)
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    WEAK_PASSWORD: 'WEAK_PASSWORD',
    ILLEGAL_STATUS_TRANSITION: 'ILLEGAL_STATUS_TRANSITION',
    EMPTY_INPUT: 'EMPTY_INPUT',
    TARGET_CUTOFF_REQUIRED: 'TARGET_CUTOFF_REQUIRED',

    // Auth & Authorization (HTTP 401 / 403)
    UNAUTHORIZED: 'UNAUTHORIZED',
    AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
    FORBIDDEN: 'FORBIDDEN',

    // Conflict (HTTP 409)
    CONFLICT: 'CONFLICT',
    EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
    TIMETABLE_OVERLAP: 'TIMETABLE_OVERLAP',

    // Monetization (HTTP 402 / 429)
    UPGRADE_REQUIRED: 'UPGRADE_REQUIRED',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    PAYMENT_FAILED: 'PAYMENT_FAILED',

    // Not found (HTTP 404)
    NOT_FOUND: 'NOT_FOUND',

    // External / infrastructure (HTTP 5xx)
    AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
    REFERENCE_DATA_UNAVAILABLE: 'REFERENCE_DATA_UNAVAILABLE',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The body shape returned for every failure response. */
export interface ErrorEnvelope {
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}

/**
 * Build a JSON error envelope object. `details` is omitted entirely when not provided
 * so the serialized payload stays minimal.
 */
export function errorEnvelope(code: string, message: string, details?: unknown): ErrorEnvelope {
    const error: ErrorEnvelope['error'] = { code, message };
    if (details !== undefined) {
        error.details = details;
    }
    return { error };
}

/**
 * Build a `Response` carrying the error envelope as JSON with the given HTTP status.
 * Usable directly from Next.js API route handlers.
 */
export function errorResponse(
    status: number,
    code: string,
    message: string,
    details?: unknown,
): Response {
    return Response.json(errorEnvelope(code, message, details), { status });
}
