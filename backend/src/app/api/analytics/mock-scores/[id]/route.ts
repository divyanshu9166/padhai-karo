/**
 * /api/analytics/mock-scores/:id (task 26.1, design "External Mock Score endpoints (Req 1)";
 * Req 1.5, 14.1).
 *
 * PATCH edits an existing External_Mock_Score (the patch is merged onto the persisted record
 * and re-validated, Req 1.5). DELETE removes a single mock score. Both enforce per-user
 * ownership in the service — a missing row returns `404 NOT_FOUND`, a row owned by another
 * user yields `403 FORBIDDEN`.
 *
 * Both handlers are guarded per the design "Authentication Posture" by {@link withAuth}:
 * unauthenticated requests are rejected with `401 UNAUTHORIZED` before the handler runs. The
 * framework forwards the dynamic `:id` segment as the route context's `params.id`, which
 * `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { MockScoreRouteContext } from '@/services/analytics/mockScoreService';
import {
    deleteMockScoreHandler,
    editMockScoreHandler,
} from '@/services/analytics/mockScoreService';

export const PATCH = withAuth<MockScoreRouteContext>((request, auth, routeContext) =>
    editMockScoreHandler(request, auth, routeContext),
);

export const DELETE = withAuth<MockScoreRouteContext>((request, auth, routeContext) =>
    deleteMockScoreHandler(request, auth, routeContext),
);
