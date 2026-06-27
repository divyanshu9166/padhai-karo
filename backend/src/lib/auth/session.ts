/**
 * Session-token issuance, validation, and revocation (Req 1; design "Session Token
 * Handling").
 *
 * This module OWNS the session token. Per the design:
 *   - Session tokens are **high-entropy opaque values** (256 bits of CSPRNG output,
 *     base64url-encoded). They carry no structure and are never derived from user data.
 *   - Only a **hash** of the token is persisted, never the raw token. Because the raw
 *     token is itself high-entropy, a fast cryptographic hash (SHA-256) is the correct
 *     choice here — unlike passwords, there is no low-entropy secret to stretch, so a
 *     memory-hard KDF would add cost without adding security.
 *   - Every session has an **expiry**; logout and expiry both invalidate the stored
 *     session (Req 1.7 / Error Handling: expired tokens are rejected).
 *
 * The raw token is returned to the caller exactly once — at creation — and handed to
 * the client to send back as `Authorization: Bearer <token>`. The server can only ever
 * recompute the hash from a presented raw token; it cannot recover a raw token from
 * storage.
 *
 * Exported primitives (consumed by the route handlers here and by the session-validation
 * middleware in task 2.3):
 *   - {@link createSession} — issue a new session for a user.
 *   - {@link resolveSession} — validate a presented raw token, returning the owning user
 *     and session, or `null` when the token is unknown/expired.
 *   - {@link revokeSession} — invalidate a session by its raw token (logout).
 *   - {@link extractBearerToken} — parse a raw token out of an `Authorization` header.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { Session, User } from '@prisma/client';

import { prisma } from '@/lib/db';

/** Number of random bytes in a session token (256 bits of entropy). */
const TOKEN_BYTES = 32;

/**
 * Session lifetime in milliseconds. Sessions older than this are treated as expired by
 * {@link resolveSession} and are not honored regardless of presence in the store.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Generate a new high-entropy opaque session token. The value is URL-safe so it travels
 * cleanly in an `Authorization` header.
 */
export function generateSessionToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Compute the at-rest representation of a token. Only this hash is ever stored or
 * queried; the raw token is never persisted. SHA-256 is appropriate because the input is
 * already high-entropy (see module docs).
 */
export function hashSessionToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
}

/** A newly issued session: the raw token (returned once) plus the persisted row. */
export interface IssuedSession {
    /** The raw opaque token to hand to the client. Never stored server-side. */
    rawToken: string;
    /** The persisted session row (whose `token` column holds the hash, not the raw). */
    session: Session;
}

/**
 * Issue a new authenticated session for the given user (Req 1.1, 1.4).
 *
 * Generates a fresh high-entropy token, stores only its hash together with an expiry,
 * and returns the raw token to the caller for delivery to the client.
 */
export async function createSession(userId: string): Promise<IssuedSession> {
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const session = await prisma.session.create({
        data: { userId, token: tokenHash, expiresAt },
    });

    return { rawToken, session };
}

/** The owning user and session resolved from a presented raw token. */
export interface ResolvedSession {
    user: User;
    session: Session;
}

/**
 * Validate a presented raw session token (Req 1.7).
 *
 * Returns the owning {@link User} and {@link Session} when the token matches a live
 * session, or `null` when:
 *   - the token is empty/absent,
 *   - no session matches the token hash, or
 *   - the matching session has expired.
 *
 * Expired sessions are proactively deleted so the store self-cleans as stale tokens are
 * presented. Returning `null` (rather than throwing) lets callers map every "no valid
 * session" case to a single authorization error.
 */
export async function resolveSession(rawToken: string): Promise<ResolvedSession | null> {
    if (!rawToken) {
        return null;
    }

    const tokenHash = hashSessionToken(rawToken);
    const session = await prisma.session.findUnique({
        where: { token: tokenHash },
        include: { user: true },
    });

    if (!session) {
        return null;
    }

    if (session.expiresAt.getTime() <= Date.now()) {
        // Best-effort cleanup of the expired row; ignore races where it is already gone.
        await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
        return null;
    }

    const { user, ...sessionRow } = session;
    return { user, session: sessionRow };
}

/**
 * Invalidate a session by its raw token (logout). Idempotent: revoking an unknown or
 * already-removed token is a no-op and resolves without error.
 */
export async function revokeSession(rawToken: string): Promise<void> {
    if (!rawToken) {
        return;
    }
    const tokenHash = hashSessionToken(rawToken);
    await prisma.session.deleteMany({ where: { token: tokenHash } });
}

/**
 * Extract the raw bearer token from an `Authorization` header value.
 *
 * Accepts the standard `Bearer <token>` form (scheme is case-insensitive). Returns the
 * token, or `null` when the header is missing, malformed, or carries an empty token.
 */
export function extractBearerToken(authorizationHeader: string | null | undefined): string | null {
    if (!authorizationHeader) {
        return null;
    }
    const match = /^Bearer (.+)$/i.exec(authorizationHeader.trim());
    if (!match) {
        return null;
    }
    const token = match[1].trim();
    return token.length > 0 ? token : null;
}
