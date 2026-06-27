/**
 * GET /api/papers/:id (task 13.1, design "Timed Paper Mode Service").
 *
 * Returns a PYQ_Paper's standard duration and its practice-eligible questions for a Timed
 * Paper session. Guarded per the design "Authentication Posture" by {@link withAuth}
 * (task 2.3): unauthenticated requests are rejected with 401 UNAUTHORIZED before the
 * handler runs. The listing deliberately OMITS `correctOption` so the answer key cannot be
 * read before submission; authoritative scoring happens server-side on submission via the
 * shared pure scoring function.
 *
 * The framework forwards the dynamic `:id` segment as the route context's `params.id`,
 * which `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { IdRouteContext } from '@/services/timedPaper';
import { getPaperHandler } from '@/services/timedPaper';

export const GET = withAuth<IdRouteContext>((request, ctx, routeContext) =>
    getPaperHandler(request, ctx, routeContext),
);
