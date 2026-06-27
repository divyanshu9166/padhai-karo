/**
 * Profile Service handlers (task 4.2; design "Onboarding / Profile Service", section 2).
 *
 * Implements the post-onboarding profile management endpoints, each scoped to the
 * authenticated user (per-user isolation). Route files stay framework-thin and wrap these
 * handlers with `withAuth`, so unauthenticated requests are rejected with `401 UNAUTHORIZED`
 * before any handler runs.
 *
 *   GET    /api/profile                       -> 200 { profile }            (404 if none)
 *   PATCH  /api/profile/language              -> 200 { profile }            (Req 10.1)
 *   PATCH  /api/profile/peak-windows          -> 200 { profile }            (Req 2.8)
 *   POST   /api/profile/fixed-commitments     -> 201 { commitment }         (Req 2.1, 2.3)
 *   DELETE /api/profile/fixed-commitments/:id -> 204                        (Req 2.3 ownership)
 *
 * Validation lives in the pure {@link ./profileValidation} module so it can be unit-tested
 * without a database. A `PATCH` against a user who has no profile yet surfaces as a
 * `404 NOT_FOUND` (the Prisma `P2025` "record to update not found" error), since profile
 * mutation presupposes a profile created at onboarding.
 */
import { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import {
    validateFixedCommitmentInput,
    validateLanguageInput,
    validatePeakWindowsInput,
} from './profileValidation';

/** Safely parse a JSON request body, returning `undefined` when the body is absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * `GET /api/profile` — return the authenticated user's profile (Req 2.1). Responds
 * `404 NOT_FOUND` when the user has not completed onboarding (no profile row yet).
 */
export async function getProfileHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id } });
    if (!profile) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Profile not found.');
    }
    return Response.json({ profile }, { status: 200 });
}

/**
 * `PATCH /api/profile/language` — persist the user's Language_Preference (Req 10.1).
 * Rejects an unsupported value with `422 VALIDATION_ERROR`, and a missing profile with
 * `404 NOT_FOUND`.
 */
export async function updateLanguageHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    const validation = validateLanguageInput(body);
    if (!validation.ok) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, validation.message, validation.details);
    }

    try {
        const profile = await prisma.profile.update({
            where: { userId: auth.user.id },
            data: { language: validation.value },
        });
        return Response.json({ profile }, { status: 200 });
    } catch (error) {
        return mapProfileUpdateError(error);
    }
}

/**
 * `PATCH /api/profile/peak-windows` — persist the user's Peak_Focus_Windows (Req 2.8).
 * Each value is validated and the set is de-duplicated. Rejects an invalid value with
 * `422 VALIDATION_ERROR`, and a missing profile with `404 NOT_FOUND`.
 */
export async function updatePeakWindowsHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    const validation = validatePeakWindowsInput(body);
    if (!validation.ok) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, validation.message, validation.details);
    }

    try {
        const profile = await prisma.profile.update({
            where: { userId: auth.user.id },
            data: { peakFocusWindows: validation.value },
        });
        return Response.json({ profile }, { status: 200 });
    } catch (error) {
        return mapProfileUpdateError(error);
    }
}

/**
 * `POST /api/profile/fixed-commitments` — create a single Fixed_Commitment for the user
 * (Req 2.1). Rejects a commitment whose end time is not later than its start time, or any
 * malformed field, with `422 VALIDATION_ERROR` (Req 2.3).
 */
export async function createFixedCommitmentHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    const validation = validateFixedCommitmentInput(body);
    if (!validation.ok) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, validation.message, validation.details);
    }

    const { dayOfWeek, startTime, endTime, label } = validation.value;
    const commitment = await prisma.fixedCommitment.create({
        data: { userId: auth.user.id, dayOfWeek, startTime, endTime, label },
    });
    return Response.json({ commitment }, { status: 201 });
}

/**
 * `DELETE /api/profile/fixed-commitments/:id` — remove one of the user's fixed commitments
 * (Req 2.3 ownership). Enforces per-user ownership via {@link assertOwnership}: a commitment
 * that does not exist or belongs to another user yields `404 NOT_FOUND` / `403 FORBIDDEN`
 * respectively, without revealing another user's data. Responds `204` on success.
 *
 * @param routeContext - the framework's dynamic-route context carrying `params.id`.
 */
export async function deleteFixedCommitmentHandler(
    _request: Request,
    auth: AuthContext,
    routeContext: { params: { id: string } },
): Promise<Response> {
    const { id } = routeContext.params;

    const commitment = await prisma.fixedCommitment.findUnique({ where: { id } });
    if (!commitment) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Fixed commitment not found.');
    }
    // Throws ForbiddenError -> 403 (mapped by withAuth) on a cross-user delete attempt.
    assertOwnership(commitment.userId, auth.user.id);

    await prisma.fixedCommitment.delete({ where: { id } });
    return new Response(null, { status: 204 });
}

/**
 * Map a Prisma error from a profile `update` to an HTTP response. A `P2025` ("record to
 * update not found") means the authenticated user has no profile yet, surfaced as
 * `404 NOT_FOUND`; anything else re-throws for the framework's error boundary.
 */
function mapProfileUpdateError(error: unknown): Response {
    if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
    ) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Profile not found.');
    }
    throw error;
}
