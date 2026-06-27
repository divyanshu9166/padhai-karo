/**
 * External Mock Score service (task 15.1; design "External Mock Score endpoints (Req 1)";
 * Req 1.1, 1.5, 14.2, 14.3).
 *
 * Implements the External_Mock_Score CRUD endpoints, each scoped to the authenticated user
 * (per-user isolation, Req 14.2). The route files wrap these handlers with `withAuth`, so
 * unauthenticated requests are rejected with `401 UNAUTHORIZED` before any handler runs.
 *
 *   POST   /api/analytics/mock-scores
 *     body: { source, sourceName?, testDate, obtainedScore, maxScore }
 *     -> 201 { mockScore }                                          (Req 1.1)
 *     -> 422 VALIDATION_ERROR  (invalid score bounds / future date / bad source — Req 1.2–1.4)
 *
 *   GET    /api/analytics/mock-scores
 *     -> 200 { mockScores[] }  the authenticated user's mock scores; always user-scoped.
 *
 *   PATCH  /api/analytics/mock-scores/:id
 *     body: { source?, sourceName?, testDate?, obtainedScore?, maxScore? }
 *     -> 200 { mockScore }      (the patch merged onto the persisted record — Req 1.5)
 *     -> 404 NOT_FOUND          (no such mock score)
 *     -> 403 FORBIDDEN          (mock score owned by another user — Req 14.3)
 *     -> 422 VALIDATION_ERROR   (merged candidate fails validation — Req 1.2–1.4)
 *
 *   DELETE /api/analytics/mock-scores/:id
 *     -> 204                    (per-user ownership; 404 missing, 403 not owned — Req 14.3)
 *
 * The decision logic (validation of a candidate External_Mock_Score) lives in the pure,
 * database-free {@link ./mockScoreValidation} module so it can be unit/property-tested in
 * isolation and reused for both create and edit. For edits (Req 1.5) the patch is merged onto
 * the persisted row and the same validator re-runs against the merged candidate, so editing
 * obeys identical rules to creation. This module only orchestrates I/O and per-user scoping,
 * mirroring the Phase 1 thin-handler convention (see {@link ../calendar/calendarEventService}
 * and {@link ../mistake/mistakeService}).
 */
import { MockSeriesSource as PrismaMockSeriesSource } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import type { MockScoreInput } from './mockScoreValidation';
import { validateMockScoreInput } from './mockScoreValidation';

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Handle `POST /api/analytics/mock-scores`. Validates the body via the pure
 * {@link validateMockScoreInput} (invalid score bounds / future date / bad source -> 422,
 * Req 1.2–1.4) and persists an `ExternalMockScore` scoped to the authenticated user (Req 1.1).
 */
export async function createMockScoreHandler(
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

    const validation = validateMockScoreInput(body as MockScoreInput);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const { source, sourceName, testDate, obtainedScore, maxScore } = validation.value;

    const mockScore = await prisma.externalMockScore.create({
        data: {
            userId: auth.user.id,
            source: source as PrismaMockSeriesSource,
            sourceName,
            testDate,
            obtainedScore,
            maxScore,
        },
    });

    return Response.json({ mockScore }, { status: 201 });
}

/**
 * Handle `GET /api/analytics/mock-scores`. Returns the authenticated user's
 * External_Mock_Scores, most-recent test date first. Always user-scoped (Req 14.2).
 */
export async function listMockScoresHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const mockScores = await prisma.externalMockScore.findMany({
        where: { userId: auth.user.id },
        orderBy: [{ testDate: 'desc' }, { createdAt: 'desc' }],
    });

    return Response.json({ mockScores });
}

/** Framework route context for the dynamic `/:id` segment. */
export interface MockScoreRouteContext {
    params: { id: string };
}

/**
 * Handle `PATCH /api/analytics/mock-scores/:id`. Loads the referenced row; a missing row
 * returns `404 NOT_FOUND` and a row owned by another user yields `403 FORBIDDEN` via
 * {@link assertOwnership} (Req 14.3). The patch is merged onto the persisted record and the
 * merged candidate is re-validated via {@link validateMockScoreInput} (Req 1.5), so an edit
 * obeys identical rules to creation; a failing candidate returns `422 VALIDATION_ERROR`.
 */
export async function editMockScoreHandler(
    request: Request,
    auth: AuthContext,
    routeContext: MockScoreRouteContext,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A mock score id is required.', {
            field: 'id',
        });
    }

    const body = await readJsonBody(request);
    if (typeof body !== 'object' || body === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must be a JSON object.',
        );
    }
    const patch = body as MockScoreInput;

    const existing = await prisma.externalMockScore.findUnique({ where: { id } });
    if (!existing) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Mock score not found.');
    }

    // Cross-user edit attempt -> 403 FORBIDDEN (thrown, mapped by withAuth).
    assertOwnership(existing.userId, auth.user.id);

    // Merge the patch onto the persisted record: a field present in the patch overrides the
    // stored value, an absent field retains it. The merged candidate is then re-validated so
    // editing obeys identical rules to creation (Req 1.5).
    const merged: MockScoreInput = {
        source: 'source' in patch ? patch.source : existing.source,
        sourceName: 'sourceName' in patch ? patch.sourceName : existing.sourceName,
        testDate: 'testDate' in patch ? patch.testDate : existing.testDate,
        obtainedScore: 'obtainedScore' in patch ? patch.obtainedScore : existing.obtainedScore,
        maxScore: 'maxScore' in patch ? patch.maxScore : existing.maxScore,
    };

    const validation = validateMockScoreInput(merged);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const { source, sourceName, testDate, obtainedScore, maxScore } = validation.value;

    const mockScore = await prisma.externalMockScore.update({
        where: { id },
        data: {
            source: source as PrismaMockSeriesSource,
            sourceName,
            testDate,
            obtainedScore,
            maxScore,
        },
    });

    return Response.json({ mockScore }, { status: 200 });
}

/**
 * Handle `DELETE /api/analytics/mock-scores/:id`. Removes a single External_Mock_Score after
 * enforcing per-user ownership: a missing row returns `404 NOT_FOUND`; a row owned by another
 * user yields `403 FORBIDDEN` via {@link assertOwnership} (mapped by `withAuth`, Req 14.3). On
 * success returns `204 No Content`.
 */
export async function deleteMockScoreHandler(
    _request: Request,
    auth: AuthContext,
    routeContext: MockScoreRouteContext,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A mock score id is required.', {
            field: 'id',
        });
    }

    const existing = await prisma.externalMockScore.findUnique({
        where: { id },
        select: { id: true, userId: true },
    });

    if (!existing) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Mock score not found.');
    }

    // Cross-user delete attempt -> 403 FORBIDDEN (thrown, mapped by withAuth).
    assertOwnership(existing.userId, auth.user.id);

    await prisma.externalMockScore.delete({ where: { id } });

    return new Response(null, { status: 204 });
}
