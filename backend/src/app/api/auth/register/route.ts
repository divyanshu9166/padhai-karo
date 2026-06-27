/**
 * POST /api/auth/register — create an account and return an authenticated session
 * (Req 1.1, 1.2, 1.3).
 *
 * Unauthenticated endpoint (design "Authentication Posture").
 *
 * Outcomes:
 *   - `201 { token, user }` on success: the password is stored as an argon2id hash and a
 *     fresh session token is issued (Req 1.1).
 *   - `422 WEAK_PASSWORD` when the password fails the policy, naming the unmet
 *     requirement in `details` (Req 1.3).
 *   - `422 VALIDATION_ERROR` when the email is missing or malformed, or the body is not
 *     valid JSON with string fields.
 *   - `409 EMAIL_ALREADY_EXISTS` when the email is already registered (Req 1.2),
 *     including the race where a concurrent request inserts the same email first.
 */
import {
    createSession,
    hashPassword,
    isValidEmail,
    normalizeEmail,
    toPublicUser,
    validatePassword,
} from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

interface RegisterBody {
    email: string;
    password: string;
}

/** Parse and shape-check the request body; returns `null` on any malformed input. */
async function parseBody(request: Request): Promise<RegisterBody | null> {
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

export async function POST(request: Request): Promise<Response> {
    const body = await parseBody(request);
    if (!body) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must include a string email and password.',
        );
    }

    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A valid email address is required.', {
            field: 'email',
        });
    }

    // Validate password policy before the (memory-hard) hash so weak passwords are cheap
    // to reject and the response can name the specific unmet requirement (Req 1.3).
    const policy = validatePassword(body.password);
    if (!policy.valid) {
        return errorResponse(422, ErrorCode.WEAK_PASSWORD, policy.message, {
            requirement: policy.requirement,
            unmet: policy.unmet,
        });
    }

    // Pre-check for a duplicate email to return a clean 409 in the common case (Req 1.2).
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        return errorResponse(
            409,
            ErrorCode.EMAIL_ALREADY_EXISTS,
            'An account with this email already exists.',
        );
    }

    const passwordHash = await hashPassword(body.password);

    let user;
    try {
        user = await prisma.user.create({ data: { email, passwordHash } });
    } catch (err) {
        // Unique-constraint violation from a concurrent insert of the same email: the
        // pre-check passed but another request won the race. Surface the same 409.
        if (isUniqueConstraintError(err)) {
            return errorResponse(
                409,
                ErrorCode.EMAIL_ALREADY_EXISTS,
                'An account with this email already exists.',
            );
        }
        throw err;
    }

    const { rawToken } = await createSession(user.id);

    return Response.json({ token: rawToken, user: toPublicUser(user) }, { status: 201 });
}

/** Detect Prisma's P2002 unique-constraint error without importing the error class. */
function isUniqueConstraintError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: unknown }).code === 'P2002'
    );
}
