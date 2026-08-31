/**
 * Chapter / Syllabus Tracking Service handlers (task 5.1; design "Chapter / Syllabus
 * Tracking Service"; Req 12.1, 12.2).
 *
 * Implements the two endpoints owned by task 5.1:
 *
 *   GET /api/chapters
 *     -> 200 { chapters[] }  the authenticated user's chapters with status, weightage,
 *                            estHours, and any overrides.
 *
 *   PATCH /api/chapters/:id/status
 *     body: { status }
 *     -> 200 { chapter }                       on an accepted forward transition (Req 12.1)
 *     -> 422 VALIDATION_ERROR                  when `status` is missing/unknown
 *     -> 422 ILLEGAL_STATUS_TRANSITION         on a backward/illegal/no-op transition (12.2)
 *     -> 404 NOT_FOUND                         when no chapter has that id
 *     -> 403 FORBIDDEN                         when the chapter belongs to another user
 *
 * Per-user isolation: GET scopes its query by `auth.user.id`; PATCH asserts ownership of
 * the targeted chapter before mutating it. The transition rule lives in the pure
 * {@link isValidStatusTransition} so it is unit-testable and shared with Property 26.
 *
 * Out of scope for task 5.1 (do NOT implement here): the override endpoints (task 5.2) and
 * syllabus completion (task 5.3).
 */
import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { addUtcDays, REVISION_SEQUENCE } from '@/lib/revision/sequence';

import { isChapterStatus, isValidStatusTransition } from './chapterStatus';

/**
 * Columns returned to the client for each chapter. Exposes the lifecycle status, effective
 * weightage (and its default-fallback flag), estimated study hours, and the three optional
 * overrides, plus identifying fields. Mirrors the design table's
 * "(status, weightage, estHours, overrides)".
 */
export const CHAPTER_CLIENT_SELECT = {
    id: true,
    subjectId: true,
    referenceKey: true,
    name: true,
    status: true,
    weightage: true,
    weightageIsDefault: true,
    estimatedStudyHours: true,
    taskDifficulty: true,
    weightageOverride: true,
    estHoursOverride: true,
    timeAllocationOverride: true,
} as const;

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Handle `GET /api/chapters`. Returns every chapter owned by the authenticated user with
 * its status, weightage, estimated hours, and overrides. Scoped to `auth.user.id` for
 * per-user isolation; ordered deterministically for stable client rendering.
 */
export async function listChaptersHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const chapters = await prisma.chapter.findMany({
        where: { userId: auth.user.id },
        select: CHAPTER_CLIENT_SELECT,
        orderBy: [{ subjectId: 'asc' }, { name: 'asc' }],
    });

    return Response.json({ chapters });
}

/**
 * Handle `PATCH /api/chapters/:id/status`. Validates the requested status, loads the
 * chapter, asserts the caller owns it, enforces the forward-only lifecycle rule, and
 * persists the new status.
 *
 * @param chapterId - the `:id` path segment (forwarded from the route).
 */
export async function updateChapterStatusHandler(
    request: Request,
    auth: AuthContext,
    chapterId: string,
): Promise<Response> {
    const body = await readJsonBody(request);
    if (typeof body !== 'object' || body === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must be a JSON object.',
        );
    }

    const { status } = body as Record<string, unknown>;
    if (!isChapterStatus(status)) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'A valid "status" is required (NOT_STARTED, IN_PROGRESS, DONE, or REVISED).',
            { field: 'status' },
        );
    }

    const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { id: true, userId: true, status: true },
    });

    if (!chapter) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Chapter not found.');
    }

    // Per-user isolation: reject access to another user's chapter (403). Thrown
    // ForbiddenError is mapped to 403 by withAuth.
    assertOwnership(chapter.userId, auth.user.id);

    // Enforce the forward-only lifecycle (Req 12.2). Backward, illegal, and same-state
    // (no-op) transitions are rejected as 422 ILLEGAL_STATUS_TRANSITION.
    if (!isValidStatusTransition(chapter.status, status)) {
        return errorResponse(
            422,
            ErrorCode.ILLEGAL_STATUS_TRANSITION,
            `Cannot change chapter status from ${chapter.status} to ${status}. ` +
            'Status may only move forward along NOT_STARTED → IN_PROGRESS → DONE → REVISED.',
            { from: chapter.status, to: status },
        );
    }

    const updated = await prisma.$transaction(async (tx) => {
        const next = await tx.chapter.update({
            where: { id: chapterId },
            data: { status },
            select: CHAPTER_CLIENT_SELECT,
        });
        if (status === 'DONE') {
            const existingCards = await tx.revisionCard.findMany({
                where: { userId: auth.user.id, sourceType: 'CHAPTER', sourceId: chapterId },
                select: { id: true, revisionPhase: true },
            });
            const existingByPhase = new Map(existingCards.map((card) => [card.revisionPhase, card]));
            const firstStudyAt = new Date();
            for (const phase of REVISION_SEQUENCE.slice(1)) {
                let existing = existingByPhase.get(phase.phase);
                const legacy = phase.phase === 'REVISION_1' ? existingByPhase.get(null) : undefined;
                if (!existing && legacy) {
                    existing = await tx.revisionCard.update({ where: { id: legacy.id }, data: { title: `${next.name} · ${phase.label}`, revisionPhase: phase.phase, tags: [`+${phase.offsetDays}`, phase.label], dueAt: addUtcDays(firstStudyAt, phase.offsetDays) }, select: { id: true, revisionPhase: true } });
                    existingByPhase.set(phase.phase, existing);
                }
                if (existing) continue;
                await tx.revisionCard.create({
                    data: {
                        userId: auth.user.id,
                        title: `${next.name} · ${phase.label}`,
                        prompt: `Recall the key concepts, examples and common traps in ${next.name}.`,
                        answer: 'Explain it without looking, then solve one related PYQ.',
                        sourceType: 'CHAPTER',
                        sourceId: chapterId,
                        chapterId,
                        revisionPhase: phase.phase,
                        tags: [`+${phase.offsetDays}`, phase.label],
                        dueAt: addUtcDays(firstStudyAt, phase.offsetDays),
                    },
                });
            }
        }
        return next;
    });

    return Response.json({ chapter: updated });
}
