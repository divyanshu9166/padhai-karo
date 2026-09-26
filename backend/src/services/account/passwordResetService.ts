/**
 * Password reset by emailed one-time code.
 *
 *   POST /api/auth/password-reset/request  { email }
 *     -> 200 always for a well-formed email (never reveals whether an account exists)
 *     -> 429 TOO_MANY_ATTEMPTS   (3 codes per email / 20 requests per address, per hour)
 *     -> 503 EMAIL_UNAVAILABLE   (production without an email provider configured)
 *
 *   POST /api/auth/password-reset/confirm  { email, code, newPassword }
 *     -> 200 { token, user }     password changed, every old session revoked, new session issued
 *     -> 400 INVALID_RESET_CODE  wrong, expired, used, or over-guessed code
 *     -> 422 WEAK_PASSWORD       new password fails the registration policy
 *     -> 429 TOO_MANY_ATTEMPTS
 *
 * Codes are 6 digits, valid for 15 minutes, single-use, and die after 5 wrong guesses.
 * Requesting a new code invalidates any earlier one. Only an argon2 hash of the code is
 * stored, so a database read does not expose live codes.
 */
import { randomInt } from 'node:crypto';

import {
    RESET_ATTEMPTS_PER_IP,
    RESET_REQUESTS_PER_EMAIL,
    clientAddress,
    consumeAttempt,
    createSession,
    hashPassword,
    isValidEmail,
    normalizeEmail,
    toPublicUser,
    tooManyAttemptsResponse,
    validatePassword,
    verifyPassword,
} from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { emailDeliveryConfigured, sendEmail } from '@/lib/mail';

export const RESET_CODE_TTL_MS = 15 * 60 * 1000;
export const RESET_CODE_MAX_GUESSES = 5;

const GENERIC_REQUEST_MESSAGE = 'If an account exists for this email, a 6-digit reset code has been sent. It expires in 15 minutes.';

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
    try {
        const body: unknown = await request.json();
        return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

export function generateResetCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function invalidCode(): Response {
    return errorResponse(400, ErrorCode.INVALID_RESET_CODE, 'This reset code is invalid or has expired. Request a new code and try again.');
}

export async function requestPasswordResetHandler(request: Request): Promise<Response> {
    const body = await readObject(request);
    const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
    if (!isValidEmail(email)) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A valid email address is required.', { field: 'email' });
    }

    // Checked before the account lookup so the response cannot reveal account existence.
    if (!emailDeliveryConfigured() && process.env.NODE_ENV === 'production') {
        return errorResponse(503, ErrorCode.EMAIL_UNAVAILABLE, 'Password reset email is temporarily unavailable. Please contact support.');
    }

    const ipWait = await consumeAttempt(RESET_ATTEMPTS_PER_IP, clientAddress(request));
    if (ipWait > 0) return tooManyAttemptsResponse(ipWait);
    const emailWait = await consumeAttempt(RESET_REQUESTS_PER_EMAIL, email);
    if (emailWait > 0) return tooManyAttemptsResponse(emailWait);

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (user) {
        const code = generateResetCode();
        const now = new Date();
        await prisma.$transaction([
            prisma.passwordResetToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } }),
            prisma.passwordResetToken.create({
                data: { userId: user.id, codeHash: await hashPassword(code), expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MS) },
            }),
        ]);
        await sendEmail({
            to: user.email,
            subject: 'Your Padhai Karo password reset code',
            text:
                `Your Padhai Karo password reset code is ${code}.\n\n` +
                'It expires in 15 minutes. If you did not ask to reset your password, you can ignore this email; your password stays unchanged.\n\n' +
                `आपका Padhai Karo पासवर्ड रीसेट कोड ${code} है। यह 15 मिनट में समाप्त हो जाएगा।`,
        });
    } else {
        // Comparable work so response timing does not reveal whether the email is registered.
        await hashPassword(generateResetCode());
    }

    return Response.json({ message: GENERIC_REQUEST_MESSAGE }, { status: 200 });
}

export async function confirmPasswordResetHandler(request: Request): Promise<Response> {
    const body = await readObject(request);
    const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : null;
    if (!isValidEmail(email) || newPassword === null) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Email, reset code, and new password are required.');
    }

    const ipWait = await consumeAttempt(RESET_ATTEMPTS_PER_IP, clientAddress(request));
    if (ipWait > 0) return tooManyAttemptsResponse(ipWait);

    if (!/^\d{6}$/.test(code)) return invalidCode();

    const policy = validatePassword(newPassword);
    if (!policy.valid) {
        return errorResponse(422, ErrorCode.WEAK_PASSWORD, policy.message, { requirement: policy.requirement, unmet: policy.unmet });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const token = user
        ? await prisma.passwordResetToken.findFirst({
              where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
              orderBy: { createdAt: 'desc' },
          })
        : null;
    if (!user || !token || token.attempts >= RESET_CODE_MAX_GUESSES) {
        await hashPassword(code);
        return invalidCode();
    }

    if (!(await verifyPassword(code, token.codeHash))) {
        const guesses = token.attempts + 1;
        await prisma.passwordResetToken.update({
            where: { id: token.id },
            data: guesses >= RESET_CODE_MAX_GUESSES ? { attempts: guesses, consumedAt: new Date() } : { attempts: guesses },
        });
        return invalidCode();
    }

    const passwordHash = await hashPassword(newPassword);
    // Claim the code first: the `consumedAt: null` guard makes a concurrently replayed code lose
    // the race. The password change and session revocation then commit together in a batch
    // transaction, which (unlike an interactive one) cannot expire mid-way on a busy server.
    // If that batch fails the code stays consumed, so the student simply requests a new one.
    const claim = await prisma.passwordResetToken.updateMany({ where: { id: token.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (claim.count !== 1) return invalidCode();
    await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
        prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    const { rawToken } = await createSession(user.id);
    return Response.json({ token: rawToken, user: toPublicUser(user) }, { status: 200 });
}
