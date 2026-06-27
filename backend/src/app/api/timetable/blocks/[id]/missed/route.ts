/**
 * /api/timetable/blocks/:id/missed (design "Adaptive Rebalancer"; Req 15.2, 15.3).
 *
 * POST marks the identified study block as missed and runs the Adaptive_Rebalancer: the
 * missed work is moved into the earliest fitting `Buffer_Slot` before any other subject is
 * reduced (Req 15.2); only when no buffer fits are other subjects' blocks compressed
 * (Req 15.3). The handler is wrapped by {@link withAuth} (task 2.3), so a request without a
 * valid `Authorization: Bearer <token>` session is rejected with `401 UNAUTHORIZED` before it
 * runs; per-user ownership of the block is enforced inside the handler.
 */
import { withAuth } from '@/lib/auth';
import type { BlockRouteContext } from '@/services/timetable';
import { missedBlockHandler } from '@/services/timetable';

export const POST = withAuth<BlockRouteContext>((request, auth, routeContext) =>
    missedBlockHandler(request, auth, routeContext),
);
