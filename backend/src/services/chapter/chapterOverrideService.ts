/**
 * Chapter override endpoint handlers (task 5.2; design "Chapter / Syllabus Tracking
 * Service"; Req 11.3, 11.4).
 *
 * Implements the two override endpoints, leaving task 5.1's status-transition logic
 * untouched:
 *
 *   PATCH /api/chapters/:id/override
 *     body: { weightageOverride?, estHoursOverride?, timeAllocationOverride? }
 *     -> 200 { chapter }            persists the provided override fields (Req 11.3)
 *     -> 422 VALIDATION_ERROR       when a provided value is not a positive number, or no
 *                                   override field is provided
 *     -> 404 NOT_FOUND              when no chapter has that id
 *     -> 403 FORBIDDEN              when the chapter belongs to another user
 *
 *   DELETE /api/chapters/:id/override
 *     -> 204                        clears ALL override fields to null (Req 11.4)
 *     -> 404 NOT_FOUND              when no chapter has that id
 *     -> 403 FORBIDDEN              when the chapter belongs to another user
 *
 * Per-user isolation: both handlers load the chapter, return 404 when it does not exist,
 * then assert ownership ({@link assertOwnership} throws → 403 via withAuth) before any
 * mutation. The body-validation rule lives in the pure
 * {@link validateChapterOverrideInput} so it is unit-testable and framework-independent.
 *
 * Overrides are persisted on the Chapter row and survive future timetable generations; the
 * generator reading them back is the timetable engine's concern (task 6.2). Here we only
 * persist (PATCH) and clear (DELETE) correctly.
 */
import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { CHAPTER_CLIENT_SELECT } from './chapterService';
import { validateChapterOverrideInput } from './overrideValidation';

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Handle `PATCH /api/chapters/:id/override`. Validates the provided override fields, loads
 * the chapter, asserts the caller owns it, and persists ONLY the provided fields so partial
 * overrides leave the others untouched (Req 11.3).
 *
 * @param chapterId - the `:id` path segment (forwarded from the route).
 */
export async function updateChapterOverrideHandler(
    request: Request,
    auth: AuthContext,
    chapterId: string,
): Promise<Response> {
    const body = await readJsonBody(request);

    const validation = validateChapterOverrideInput(body);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { id: true, userId: true },
    });

    if (!chapter) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Chapter not found.');
    }

    // Per-user isolation: reject access to another user's chapter (403). Thrown
    // ForbiddenError is mapped to 403 by withAuth.
    assertOwnership(chapter.userId, auth.user.id);

    const updated = await prisma.chapter.update({
        where: { id: chapterId },
        // Only the provided override fields are present in `validation.value`, so absent
        // fields are left unchanged (partial update, Req 11.3).
        data: validation.value,
        select: CHAPTER_CLIENT_SELECT,
    });

    return Response.json({ chapter: updated });
}

/**
 * Handle `DELETE /api/chapters/:id/override`. Loads the chapter, asserts ownership, then
 * clears every override field back to `null` so the chapter reverts to its
 * weightage-driven allocation (Req 11.4). Returns 204 with no body on success.
 *
 * @param chapterId - the `:id` path segment (forwarded from the route).
 */
export async function clearChapterOverrideHandler(
    _request: Request,
    auth: AuthContext,
    chapterId: string,
): Promise<Response> {
    const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { id: true, userId: true },
    });

    if (!chapter) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Chapter not found.');
    }

    assertOwnership(chapter.userId, auth.user.id);

    await prisma.chapter.update({
        where: { id: chapterId },
        data: {
            weightageOverride: null,
            estHoursOverride: null,
            timeAllocationOverride: null,
        },
    });

    return new Response(null, { status: 204 });
}
