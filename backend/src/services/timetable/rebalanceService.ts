/**
 * Adaptive rebalancer + buffer-policy + unused-buffer-conversion handlers (task 6.8; design
 * "Adaptive Rebalancer" and "Timetable Generation Service" rows; Req 15.2, 15.3, 15.4, 15.5).
 *
 *   POST  /api/timetable/blocks/:id/missed     — mark a block missed and rebalance.
 *     -> 200 { rebalanced: studyBlocks[] }      buffer-filled (Req 15.2) or compressed (15.3)
 *     -> 422 VALIDATION_ERROR                   the target block is itself a buffer slot
 *     -> 404 NOT_FOUND                          block does not exist
 *     -> 403 FORBIDDEN                          block owned by another user
 *
 *   PATCH /api/timetable/buffer-policy          body { policy: "CATCH_UP" | "EXTRA_REVISION" }
 *     -> 200 { bufferPolicy }                   persisted on the user's Profile (Req 15.4)
 *     -> 422 VALIDATION_ERROR                   invalid policy value
 *     -> 404 NOT_FOUND                          user has not completed onboarding (no profile)
 *
 *   POST  /api/timetable/convert-unused-buffers body { weekStart }
 *     -> 200 { converted[], policy }            end-of-week conversion of unused buffers (15.5)
 *     -> 422 VALIDATION_ERROR                   invalid weekStart
 *     -> 404 NOT_FOUND                          no timetable / profile for the week
 *
 * All scheduling intelligence lives in the pure `./rebalance` module; this file only loads
 * rows, applies the resulting plan inside a transaction, and shapes the HTTP response. The
 * route files wrap each handler with `withAuth`, so unauthenticated requests are rejected
 * with 401 before any handler runs (Req 1.7), and a `ForbiddenError` from `assertOwnership`
 * becomes a 403. Both rebalancing strategies only repurpose a buffer in place or shrink
 * durations, so the no-overlap invariant (Req 3.3) is preserved without re-checking overlaps.
 */
import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { startOfUtcDay } from '@/services/dashboard';

import type { BlockRouteContext } from './blockEditService';
import {
    convertUnusedBuffers,
    parseBufferPolicy,
    planRebalance,
    type RebalanceBlock,
} from './rebalance';

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/** Columns of a `StudyBlock` the rebalancer needs; mapped to a pure {@link RebalanceBlock}. */
const REBALANCE_SELECT = {
    id: true,
    subjectId: true,
    chapterId: true,
    startTime: true,
    durationMin: true,
    isBuffer: true,
} as const;

/**
 * Handle `POST /api/timetable/blocks/:id/missed`. Loads the missed block and every block in
 * its timetable, computes the rebalancing plan with {@link planRebalance} (buffer fill
 * preferred over compression, Req 15.2/15.3), and applies it atomically. Returns the
 * timetable's blocks after rebalancing.
 */
export async function missedBlockHandler(
    _request: Request,
    auth: AuthContext,
    routeContext: BlockRouteContext,
): Promise<Response> {
    const id = routeContext.params.id;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A block id is required.', {
            field: 'id',
        });
    }

    const missed = await prisma.studyBlock.findUnique({
        where: { id },
        select: { ...REBALANCE_SELECT, userId: true, timetableId: true },
    });
    if (!missed) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Study block not found.');
    }
    assertOwnership(missed.userId, auth.user.id);

    if (missed.isBuffer) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'A buffer slot cannot be reported as missed.',
            { field: 'id' },
        );
    }

    const blocks = await prisma.studyBlock.findMany({
        where: { timetableId: missed.timetableId },
        select: REBALANCE_SELECT,
    });

    const missedBlock: RebalanceBlock = {
        id: missed.id,
        subjectId: missed.subjectId,
        chapterId: missed.chapterId,
        startTime: missed.startTime,
        durationMin: missed.durationMin,
        isBuffer: missed.isBuffer,
    };
    const decision = planRebalance(missedBlock, blocks);

    await prisma.$transaction(async (tx) => {
        if (decision.strategy === 'BUFFER_FILL') {
            // Repurpose the buffer in place into the missed work, then drop the missed block.
            await tx.studyBlock.update({
                where: { id: decision.bufferId },
                data: {
                    isBuffer: false,
                    subjectId: missed.subjectId,
                    chapterId: missed.chapterId,
                },
            });
            await tx.studyBlock.delete({ where: { id: missed.id } });
        } else if (decision.strategy === 'COMPRESS') {
            // Shrink other subjects' blocks; the missed block stays scheduled in the freed room.
            for (const compression of decision.compressions) {
                await tx.studyBlock.update({
                    where: { id: compression.blockId },
                    data: { durationMin: compression.newDurationMin },
                });
            }
        }
        // strategy === 'NONE': nothing can be rebalanced; leave the timetable unchanged.
    });

    const rebalanced = await prisma.studyBlock.findMany({
        where: { timetableId: missed.timetableId },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });

    return Response.json({ rebalanced, strategy: decision.strategy }, { status: 200 });
}

/**
 * Handle `PATCH /api/timetable/buffer-policy`. Validates the requested policy and persists it
 * on the authenticated user's profile (Req 15.4). An invalid value yields 422; a user without
 * a profile (onboarding incomplete) yields 404.
 */
export async function updateBufferPolicyHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    const raw =
        body && typeof body === 'object' ? (body as Record<string, unknown>).policy : undefined;
    const policy = parseBufferPolicy(raw);
    if (!policy) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            '"policy" must be either "CATCH_UP" or "EXTRA_REVISION".',
            { field: 'policy' },
        );
    }

    const profile = await prisma.profile.findUnique({
        where: { userId: auth.user.id },
        select: { id: true },
    });
    if (!profile) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'Complete onboarding before setting a buffer policy.',
        );
    }

    const updated = await prisma.profile.update({
        where: { userId: auth.user.id },
        data: { bufferPolicy: policy },
        select: { bufferPolicy: true },
    });

    return Response.json({ bufferPolicy: updated.bufferPolicy }, { status: 200 });
}

/** Discriminated result of parsing the `weekStart` input. */
type WeekStartParse = { ok: true; weekStart: Date } | { ok: false; response: Response };

/** Parse a `weekStart` value (ISO string or epoch-millis) into a UTC-midnight Date. */
function parseWeekStart(raw: unknown): WeekStartParse {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                '"weekStart" is required as a request body field.',
                { field: 'weekStart' },
            ),
        };
    }
    const trimmed = raw.trim();
    const candidate = /^[+-]?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed;
    const date = new Date(candidate);
    if (Number.isNaN(date.getTime())) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                '"weekStart" must be a valid date.',
                { field: 'weekStart' },
            ),
        };
    }
    return { ok: true, weekStart: startOfUtcDay(date) };
}

/**
 * Handle `POST /api/timetable/convert-unused-buffers`. Intended to run at the end of the week:
 * it converts every still-reserved `Buffer_Slot` of the named week's timetable to the user's
 * chosen CATCH_UP/EXTRA_REVISION option via the pure {@link convertUnusedBuffers} transform
 * and persists the result (Req 15.5).
 */
export async function convertUnusedBuffersHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    const parsed = parseWeekStart(
        body && typeof body === 'object' ? (body as Record<string, unknown>).weekStart : undefined,
    );
    if (!parsed.ok) {
        return parsed.response;
    }
    const userId = auth.user.id;

    const profile = await prisma.profile.findUnique({
        where: { userId },
        select: { bufferPolicy: true },
    });
    if (!profile) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'Complete onboarding before converting buffers.',
        );
    }

    const timetable = await prisma.timetable.findFirst({
        where: { userId, weekStart: parsed.weekStart },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    });
    if (!timetable) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'No timetable exists for the requested week.',
        );
    }

    const unusedBuffers = await prisma.studyBlock.findMany({
        where: { timetableId: timetable.id, isBuffer: true },
        select: REBALANCE_SELECT,
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });

    const policy = profile.bufferPolicy as 'CATCH_UP' | 'EXTRA_REVISION';
    const conversions = convertUnusedBuffers(unusedBuffers, policy);

    await prisma.$transaction(
        conversions.map((conversion) =>
            prisma.studyBlock.update({
                where: { id: conversion.blockId },
                data: { isBuffer: conversion.isBuffer },
            }),
        ),
    );

    return Response.json({ converted: conversions, policy }, { status: 200 });
}
