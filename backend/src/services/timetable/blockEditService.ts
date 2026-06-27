/**
 * Study-block edit + delete handlers with atomic overlap validation (task 6.6; design
 * "Timetable Generation Service" PATCH/DELETE rows and "Edit Validation"; Req 3.4–3.7).
 *
 *   PATCH /api/timetable/blocks/:id   body { startTime?, durationMin?, subjectId? }
 *     -> 200 { studyBlock }            edit accepted and persisted (Req 3.4/3.6)
 *     -> 409 TIMETABLE_OVERLAP         proposed interval overlaps another study block or a
 *                                      fixed commitment; the WHOLE edit is rejected and the
 *                                      original block is left UNCHANGED (Req 3.5)
 *     -> 422 VALIDATION_ERROR          malformed body field
 *     -> 404 NOT_FOUND                 block does not exist (or belongs to another user)
 *     -> 403 FORBIDDEN                 block owned by another user (via assertOwnership)
 *
 *   DELETE /api/timetable/blocks/:id
 *     -> 204                           block removed (Req 3.7)
 *     -> 404 / 403                     per-user ownership, as above
 *
 * Atomicity (Req 3.5): the edit is validate-then-update performed INSIDE a single
 * transaction. Within the transaction we re-read every OTHER study block in the same
 * timetable plus the user's fixed commitments, run the pure {@link proposedBlockConflicts}
 * test, and ONLY persist the `update` when no conflict exists. On conflict the transaction
 * performs zero writes, so the original block is guaranteed unchanged; reading and updating
 * in one transaction also closes the time-of-check/time-of-use window against a concurrent
 * edit. All scheduling/overlap intelligence lives in the pure `./overlap` module; this file
 * only orchestrates I/O, per-user scoping, and HTTP shaping.
 *
 * The route file wraps these handlers with `withAuth`, so unauthenticated requests are
 * rejected with 401 before any handler runs (Req 1.7), and a `ForbiddenError` thrown by
 * {@link assertOwnership} is mapped to 403.
 */
import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { proposedBlockConflicts, type RecurringCommitment } from './overlap';

/** Framework route context for the dynamic `/:id` segment. */
export interface BlockRouteContext {
    params: { id: string };
}

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/** A validated edit patch: only the fields the client supplied are present. */
interface EditPatch {
    startTime?: Date;
    durationMin?: number;
    subjectId?: string | null;
}

/** Discriminated result of validating the PATCH body. */
type PatchParse = { ok: true; patch: EditPatch } | { ok: false; response: Response };

/**
 * Validate the `PATCH` body, accepting only the editable fields `startTime`, `durationMin`,
 * and `subjectId` (design table). Absent fields are left untouched on the block; present
 * fields are type/range checked (Req 3.4). `subjectId` may be set to `null` to clear it.
 */
function parsePatchBody(body: unknown): PatchParse {
    if (typeof body !== 'object' || body === null) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                'Request body must be a JSON object.',
            ),
        };
    }
    const record = body as Record<string, unknown>;
    const patch: EditPatch = {};

    if ('startTime' in record && record.startTime !== undefined) {
        const raw = record.startTime;
        const date =
            typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : new Date(NaN);
        if (Number.isNaN(date.getTime())) {
            return {
                ok: false,
                response: errorResponse(
                    422,
                    ErrorCode.VALIDATION_ERROR,
                    '"startTime" must be a valid date.',
                    { field: 'startTime' },
                ),
            };
        }
        patch.startTime = date;
    }

    if ('durationMin' in record && record.durationMin !== undefined) {
        const raw = record.durationMin;
        if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
            return {
                ok: false,
                response: errorResponse(
                    422,
                    ErrorCode.VALIDATION_ERROR,
                    '"durationMin" must be a positive integer number of minutes.',
                    { field: 'durationMin' },
                ),
            };
        }
        patch.durationMin = raw;
    }

    if ('subjectId' in record && record.subjectId !== undefined) {
        const raw = record.subjectId;
        if (raw !== null && (typeof raw !== 'string' || raw.trim() === '')) {
            return {
                ok: false,
                response: errorResponse(
                    422,
                    ErrorCode.VALIDATION_ERROR,
                    '"subjectId" must be a non-empty string or null.',
                    { field: 'subjectId' },
                ),
            };
        }
        patch.subjectId = raw;
    }

    return { ok: true, patch };
}

/** Validate and extract the `:id` route param, or return a 422 response. */
function parseId(routeContext: BlockRouteContext): { ok: true; id: string } | { ok: false; response: Response } {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return {
            ok: false,
            response: errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A block id is required.', {
                field: 'id',
            }),
        };
    }
    return { ok: true, id };
}

/**
 * Handle `PATCH /api/timetable/blocks/:id`. Loads the target block (user-scoped), computes
 * the proposed interval from the supplied fields, and — inside a single transaction — tests
 * it for overlap against all OTHER study blocks in the same timetable and the user's fixed
 * commitments. Any overlap rejects the whole edit with 409 leaving the block unchanged
 * (Req 3.5); otherwise the edit is persisted (Req 3.4/3.6).
 */
export async function editBlockHandler(
    request: Request,
    auth: AuthContext,
    routeContext: BlockRouteContext,
): Promise<Response> {
    const idParse = parseId(routeContext);
    if (!idParse.ok) {
        return idParse.response;
    }
    const { id } = idParse;

    const bodyParse = parsePatchBody(await readJsonBody(request));
    if (!bodyParse.ok) {
        return bodyParse.response;
    }
    const { patch } = bodyParse;

    const block = await prisma.studyBlock.findUnique({
        where: { id },
        select: {
            id: true,
            userId: true,
            timetableId: true,
            startTime: true,
            durationMin: true,
            subjectId: true,
        },
    });
    if (!block) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Study block not found.');
    }
    // Cross-user edit attempt -> 403 FORBIDDEN (thrown, mapped by withAuth).
    assertOwnership(block.userId, auth.user.id);

    // Compute the PROPOSED interval: supplied fields override, absent fields keep current.
    const proposedStart = patch.startTime ?? block.startTime;
    const proposedDuration = patch.durationMin ?? block.durationMin;
    const proposedSubjectId =
        patch.subjectId !== undefined ? patch.subjectId : block.subjectId;

    // Validate-then-update atomically: read peers + commitments, check, and only write when
    // clear. On conflict the transaction makes no changes (Req 3.5).
    const result = await prisma.$transaction(async (tx) => {
        const [otherBlocks, commitmentRows] = await Promise.all([
            tx.studyBlock.findMany({
                where: { timetableId: block.timetableId, id: { not: block.id } },
                select: { startTime: true, durationMin: true },
            }),
            tx.fixedCommitment.findMany({
                where: { userId: auth.user.id },
                select: { dayOfWeek: true, startTime: true, endTime: true },
            }),
        ]);

        const commitments: RecurringCommitment[] = commitmentRows.map((row) => ({
            dayOfWeek: row.dayOfWeek,
            startTime: row.startTime,
            endTime: row.endTime,
        }));

        const conflict = proposedBlockConflicts(
            { startTime: proposedStart, durationMin: proposedDuration },
            otherBlocks,
            commitments,
        );
        if (conflict) {
            return { conflict: true as const };
        }

        const updated = await tx.studyBlock.update({
            where: { id: block.id },
            data: {
                startTime: proposedStart,
                durationMin: proposedDuration,
                subjectId: proposedSubjectId,
            },
        });
        return { conflict: false as const, updated };
    });

    if (result.conflict) {
        return errorResponse(
            409,
            ErrorCode.TIMETABLE_OVERLAP,
            'The edited study block overlaps another study block or a fixed commitment; ' +
            'the edit was rejected and the original block is unchanged.',
        );
    }

    return Response.json({ studyBlock: result.updated }, { status: 200 });
}

/**
 * Handle `DELETE /api/timetable/blocks/:id`. Removes a single study block after enforcing
 * per-user ownership: a missing block returns 404; a block owned by another user yields 403
 * via {@link assertOwnership}. On success returns `204 No Content` (Req 3.7).
 */
export async function deleteBlockHandler(
    _request: Request,
    auth: AuthContext,
    routeContext: BlockRouteContext,
): Promise<Response> {
    const idParse = parseId(routeContext);
    if (!idParse.ok) {
        return idParse.response;
    }
    const { id } = idParse;

    const block = await prisma.studyBlock.findUnique({
        where: { id },
        select: { id: true, userId: true },
    });
    if (!block) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Study block not found.');
    }
    assertOwnership(block.userId, auth.user.id);

    await prisma.studyBlock.delete({ where: { id } });

    return new Response(null, { status: 204 });
}
