/**
 * Allocation-mode service handlers (task 12.1; design "Service layer → `modeService.ts`";
 * Req 7.1, 7.2, 7.6, 10.1, 10.3, 10.4).
 *
 * Implements the two Effective_Allocation_Mode endpoints, each scoped to the authenticated
 * user. The route file (`src/app/api/allocation/mode/route.ts`) stays framework-thin and wraps
 * these handlers with `withAuth`, so an unauthenticated request is rejected with
 * `401 UNAUTHORIZED` before any handler runs (Req 10.1).
 *
 *   GET /api/allocation/mode -> 200 { mode }            (unset => PHASE1_DEFAULT, Req 7.6)
 *   PUT /api/allocation/mode -> 200 { mode }            (422 VALIDATION_ERROR on bad mode)
 *
 * The Effective_Allocation_Mode lives in the additive `AllocationPreference` model, keyed
 * one-per-user by a unique `userId`. Every query is scoped by `ctx.user.id` for per-user
 * isolation (Req 10.2), and {@link assertOwnership} is applied to any pre-existing preference
 * row before it is read or rewritten so a row owned by another user is treated uniformly with
 * a non-existent one — a `403 FORBIDDEN` that discloses nothing about resource existence
 * (Req 10.3, 10.4).
 *
 * Validation lives in the pure {@link validateAllocationModeInput} below so it can be
 * unit-tested without a database (task 12.2). A `PUT` whose body's `mode` is not a valid
 * {@link EffectiveAllocationMode} value is rejected with `422 VALIDATION_ERROR`; a valid value
 * is upserted, so the first write creates the preference and subsequent writes update it.
 */
import { EffectiveAllocationMode } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { assertOwnership } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

/** The supported Effective_Allocation_Mode values (mirrors the Prisma enum, Req 7.1, 7.2). */
export const EFFECTIVE_ALLOCATION_MODE_VALUES = Object.values(
    EffectiveAllocationMode,
) as readonly EffectiveAllocationMode[];

/**
 * Discriminated validation result: either the parsed {@link EffectiveAllocationMode} or a
 * ready-to-serialize validation error (developer-facing `message` and optional structured
 * `details`).
 */
export type AllocationModeValidation =
    | { ok: true; value: EffectiveAllocationMode }
    | { ok: false; message: string; details?: unknown };

/** Safely parse a JSON request body, returning `undefined` when the body is absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Validate a `PUT /api/allocation/mode` payload (Req 7.1, 7.2). The body must be a JSON object
 * carrying a `mode` field equal to one of {@link EFFECTIVE_ALLOCATION_MODE_VALUES}; anything
 * else is a validation error mapped to `422 VALIDATION_ERROR` by the handler.
 */
export function validateAllocationModeInput(raw: unknown): AllocationModeValidation {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, message: 'Request body must be a JSON object.' };
    }
    const { mode } = raw as Record<string, unknown>;
    if (
        typeof mode !== 'string' ||
        !(EFFECTIVE_ALLOCATION_MODE_VALUES as readonly string[]).includes(mode)
    ) {
        return {
            ok: false,
            message: `"mode" must be one of: ${EFFECTIVE_ALLOCATION_MODE_VALUES.join(', ')}.`,
            details: { field: 'mode', allowed: EFFECTIVE_ALLOCATION_MODE_VALUES },
        };
    }
    return { ok: true, value: mode as EffectiveAllocationMode };
}

/**
 * `GET /api/allocation/mode` — return the authenticated user's Effective_Allocation_Mode.
 *
 * Reads the user's `AllocationPreference` scoped by `ctx.user.id` (Req 10.2). When a row
 * exists, ownership is asserted before it is read (Req 10.3, 10.4) and its `mode` is returned.
 * When no row exists the mode is unset, which the feature treats as `PHASE1_DEFAULT` (Req 7.6),
 * so that value is returned without creating a row.
 */
export async function getAllocationModeHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const preference = await prisma.allocationPreference.findUnique({
        where: { userId: auth.user.id },
    });

    if (preference) {
        // Treat a row owned by another user uniformly with a missing one (Req 10.3, 10.4).
        assertOwnership(preference.userId, auth.user.id);
        return Response.json({ mode: preference.mode }, { status: 200 });
    }

    // Unset preference is treated as the Phase 1 default (Req 7.6).
    return Response.json({ mode: EffectiveAllocationMode.PHASE1_DEFAULT }, { status: 200 });
}

/**
 * `PUT /api/allocation/mode` — persist the authenticated user's Effective_Allocation_Mode.
 *
 * Rejects a body whose `mode` is not a valid {@link EffectiveAllocationMode} value with
 * `422 VALIDATION_ERROR`. On a valid value, any pre-existing preference is ownership-checked
 * (Req 10.3, 10.4) and then the row is upserted, scoped by `ctx.user.id` (Req 10.2): the first
 * write creates the per-user preference, later writes update it.
 */
export async function updateAllocationModeHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    const validation = validateAllocationModeInput(body);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    // Assert ownership of any existing preference before rewriting it, so a row belonging to
    // another user is rejected as a non-ownership case without disclosing its existence
    // (Req 10.3, 10.4). Scoping the lookup by userId means this is also the upsert key.
    const existing = await prisma.allocationPreference.findUnique({
        where: { userId: auth.user.id },
    });
    if (existing) {
        assertOwnership(existing.userId, auth.user.id);
    }

    const preference = await prisma.allocationPreference.upsert({
        where: { userId: auth.user.id },
        update: { mode: validation.value },
        create: { userId: auth.user.id, mode: validation.value },
    });

    return Response.json({ mode: preference.mode }, { status: 200 });
}
