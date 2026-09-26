/**
 * POST /api/auth/login — exchange credentials for a session token (Req 1.4, 1.5).
 *
 * Unauthenticated endpoint (design "Authentication Posture").
 *
 * Outcomes:
 *   - `200 { token, user }` when the credentials match an existing account (Req 1.4).
 *   - `401 AUTHENTICATION_FAILED` otherwise (Req 1.5). The error is intentionally
 *     generic: it never reveals whether the email exists, and the password comparison
 *     uses argon2's constant-time verify (design "Password Storage & Authentication").
 *
 *   - `429 TOO_MANY_ATTEMPTS` after 5 wrong passwords for one email (15-minute lockout) or
 *     30 attempts from one client address in 15 minutes. A successful login clears the
 *     email's failure count.
 *
 *   - `429 TOO_MANY_ATTEMPTS` after 5 wrong passwords for one email (15-minute lockout) or
 *     30 attempts from one client address in 15 minutes. A successful login clears the
 *     email's failure count.
 *
 * Timing: when no account matches the email we still perform a hash with comparable cost
 * before failing, so the response time does not betray whether the email is registered.
 */
import {
    LOGIN_ATTEMPTS_PER_IP,
    LOGIN_FAILURES_PER_EMAIL,
    clearAttempts,
    clientAddress,
    consumeAttempt,
    createSession,
    hashPassword,
    normalizeEmail,
    recordAttempt,
    retryAfterSec,
    toPublicUser,
    tooManyAttemptsResponse,
    verifyPassword,
} from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

interface LoginBody {
    email: string;
    password: string;
}

/** Parse and shape-check the request body; returns `null` on any malformed input. */
async function parseBody(request: Request): Promise<LoginBody | null> {
    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        return null;
    }
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const { email, password } = raw as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
        return null;
    }
    return { email, password };
}

/** The single generic authentication failure used for every non-match (Req 1.5). */
function authFailed(): Response {
    return errorResponse(401, ErrorCode.AUTHENTICATION_FAILED, 'Invalid email or password.');
}

export async function POST(request: Request): Promise<Response> {
    const body = await parseBody(request);
    if (!body) {
        // A malformed body cannot match any account; treat as an authentication failure
        // rather than leaking a distinct validation path on the login surface.
        return authFailed();
    }

    const email = normalizeEmail(body.email);

    // Throttle before any password work. Unknown emails are limited exactly like real ones
    // so the lockout cannot be used to probe which emails are registered.
    const ipWait = await consumeAttempt(LOGIN_ATTEMPTS_PER_IP, clientAddress(request));
    if (ipWait > 0) return tooManyAttemptsResponse(ipWait);
    const emailWait = await retryAfterSec(LOGIN_FAILURES_PER_EMAIL, email);
    if (emailWait > 0) return tooManyAttemptsResponse(emailWait);

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
        // Burn comparable work to keep response timing independent of email existence,
        // then fail generically without revealing that the account is unknown.
        await hashPassword(body.password);
        await recordAttempt(LOGIN_FAILURES_PER_EMAIL, email);
        return authFailed();
    }

    const matches = await verifyPassword(body.password, user.passwordHash);
    if (!matches) {
        await recordAttempt(LOGIN_FAILURES_PER_EMAIL, email);
        return authFailed();
    }

    await clearAttempts(LOGIN_FAILURES_PER_EMAIL, email);

    const { rawToken } = await createSession(user.id);
    return Response.json({ token: rawToken, user: toPublicUser(user) }, { status: 200 });
}
