/**
 * Email normalization and format validation for the auth surface (Req 1.1, 1.2).
 *
 * Normalization (trim + lowercase) is applied before both storage and lookup so that
 * uniqueness (Req 1.2) and sign-in (Req 1.4) treat `User@Example.com` and
 * `user@example.com` as the same account.
 */

/**
 * Pragmatic email-shape check: a non-empty local part, an `@`, and a domain with at
 * least one dot and no whitespace. This intentionally favors a simple, predictable rule
 * over attempting full RFC 5322 conformance (which is not useful as a registration gate).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim surrounding whitespace and lowercase an email for canonical storage/lookup. */
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/** True when the value is a syntactically acceptable email address. */
export function isValidEmail(email: string): boolean {
    return EMAIL_PATTERN.test(email);
}
