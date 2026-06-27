/**
 * /api/timetable/blocks/:id (design "Timetable Generation Service"; Req 3.4–3.7).
 *
 * PATCH edits a single study block's start time, duration, and/or subject. The proposed
 * interval is validated for overlap against the user's other study blocks and fixed
 * commitments; any overlap rejects the whole edit with `409 TIMETABLE_OVERLAP` leaving the
 * original unchanged (Req 3.5), otherwise the edit is persisted (Req 3.4/3.6).
 *
 * DELETE removes the block (Req 3.7).
 *
 * Both handlers are wrapped by {@link withAuth} (task 2.3): a request without a valid
 * `Authorization: Bearer <token>` session is rejected with `401 UNAUTHORIZED` before the
 * handler runs, and per-user ownership is enforced inside the handler (404 missing,
 * 403 owned by another user). The framework forwards the dynamic `:id` segment as the route
 * context's `params.id`, which `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { BlockRouteContext } from '@/services/timetable';
import { deleteBlockHandler, editBlockHandler } from '@/services/timetable';

export const PATCH = withAuth<BlockRouteContext>((request, auth, routeContext) =>
    editBlockHandler(request, auth, routeContext),
);

export const DELETE = withAuth<BlockRouteContext>((request, auth, routeContext) =>
    deleteBlockHandler(request, auth, routeContext),
);
