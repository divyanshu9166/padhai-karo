/**
 * Maps an API failure into a user-facing message for the auth screens (task 21.2).
 *
 * The Backend_API returns the standard error envelope `{ error: { code, message, details? } }`,
 * surfaced by the typed client as an {@link ApiError}. This helper turns those into the precise
 * copy the auth flows require (Req 1.1, 1.4):
 *
 *   - `422 WEAK_PASSWORD`        → the policy message plus the specific unmet requirement.
 *   - `409 EMAIL_ALREADY_EXISTS` → a duplicate-email message.
 *   - `401 AUTHENTICATION_FAILED`→ a generic invalid-credentials message (login).
 *   - everything else            → the server-provided message, then a network fallback.
 *
 * Server messages are already human-readable, so we prefer them; we only special-case
 * WEAK_PASSWORD to append the unmet requirement carried in `details`.
 */
import { ApiError } from '@/api';

/** Shape of the `details` object the backend attaches to a `WEAK_PASSWORD` 422 (Req 1.3). */
interface WeakPasswordDetails {
    requirement?: string;
    unmet?: string;
}

function weakPasswordMessage(err: ApiError): string {
    const details = err.details as WeakPasswordDetails | undefined;
    const requirement = details?.requirement;
    if (typeof requirement === 'string' && requirement.trim().length > 0) {
        return `${err.message} (${requirement})`;
    }
    return err.message;
}

/** Produce the message to show the user for a failed register/login attempt. */
export function authErrorMessage(err: unknown): string {
    if (err instanceof ApiError) {
        if (err.code === 'WEAK_PASSWORD') {
            return weakPasswordMessage(err);
        }
        // 409 duplicate email, 401 invalid login, and other validation errors all carry a
        // clear server-authored message — surface it directly.
        return err.message;
    }
    // Network failure, timeout, or unexpected error: the request never reached a verdict.
    return 'Something went wrong. Check your connection and try again.';
}
