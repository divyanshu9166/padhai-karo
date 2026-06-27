/**
 * Focus Timer / Session Service handler (task 8.1; design "Focus Timer / Session Service").
 *
 * Implements the record endpoint:
 *
 *   POST /api/focus-sessions
 *     body: { subjectId, startTime, endTime, focusedDurationMin, sessionType?, clientId? }
 *     -> 201 { session }
 *     -> 422 VALIDATION_ERROR (duration <= 0 or > wall-clock span; missing/invalid subject;
 *             bad timestamps; unknown sessionType)              (Req 4.3, 4.5, 4.7, 4.8)
 *     -> 409 CONFLICT (a session with the same clientId was already recorded)  (Req 21)
 *
 * Timing happens on the client; the server validates (via the pure
 * {@link validateFocusSessionInput}) and persists. The handler stays thin: it parses the
 * body, runs validation, and writes a `FocusSession` scoped to the authenticated user. The
 * full idempotent offline-sync endpoint is task 18.1; here we simply persist an optional
 * `clientId` and lean on the `@@unique([userId, clientId])` constraint to reject an
 * accidental duplicate replay.
 */
import { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { validateFocusSessionInput } from './focusValidation';

/** Safely parse a JSON request body, returning `undefined` when the body is absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Handle `POST /api/focus-sessions`. Expects an authenticated {@link AuthContext}; the
 * route file wraps this with `withAuth` so unauthenticated requests are rejected upstream.
 * Every write is scoped to `auth.user.id` for per-user isolation.
 */
export async function recordFocusSessionHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    if (typeof body !== 'object' || body === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must be a JSON object.',
        );
    }

    const validation = validateFocusSessionInput(body as Record<string, unknown>);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const { subjectId, startTime, endTime, focusedDurationMin, sessionType, clientId } =
        validation.value;

    try {
        const session = await prisma.focusSession.create({
            data: {
                userId: auth.user.id,
                subjectId,
                startTime,
                endTime,
                focusedDurationMin,
                sessionType,
                clientId,
            },
        });
        return Response.json({ session }, { status: 201 });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            // Duplicate offline-idempotency key for this user (Req 21 seam).
            if (error.code === 'P2002') {
                return errorResponse(
                    409,
                    ErrorCode.CONFLICT,
                    'A focus session with this clientId has already been recorded.',
                    { field: 'clientId' },
                );
            }
            // Foreign-key violation: the referenced subject does not exist (Req 4.3).
            if (error.code === 'P2003') {
                return errorResponse(
                    422,
                    ErrorCode.VALIDATION_ERROR,
                    'The referenced subject does not exist.',
                    { field: 'subjectId' },
                );
            }
        }
        throw error;
    }
}
