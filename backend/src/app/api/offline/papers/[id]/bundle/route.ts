/**
 * GET /api/offline/papers/:id/bundle (task 18.1, design "Offline Sync Handler").
 *
 * Returns a downloadable PYQ_Paper + Answer_Key bundle for offline use (Req 21.1). Guarded
 * per the design "Authentication Posture" by {@link withAuth} (task 2.3): unauthenticated
 * requests are rejected with 401 UNAUTHORIZED before the handler runs. Unlike the online
 * practice listing, the bundle INCLUDES the answer key because the device must score
 * locally while offline (the canonical score is re-derived server-side on `POST /sync`).
 *
 * The framework forwards the dynamic `:id` segment as the route context's `params.id`,
 * which `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { PaperBundleRouteContext } from '@/services/sync';
import { getPaperBundleHandler } from '@/services/sync';

export const GET = withAuth<PaperBundleRouteContext>((request, ctx, routeContext) =>
    getPaperBundleHandler(request, ctx, routeContext),
);
