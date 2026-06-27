/**
 * DELETE /api/profile/fixed-commitments/:id (task 4.2, design "Onboarding / Profile Service").
 *
 * Removes one of the authenticated user's fixed commitments (Req 2.3 ownership). The guard
 * ({@link withAuth}) rejects unauthenticated requests with `401 UNAUTHORIZED` and forwards the
 * dynamic-route context (`{ params: { id } }`) to the handler, which enforces per-user
 * ownership via `assertOwnership` — a missing commitment yields `404 NOT_FOUND` and another
 * user's commitment yields `403 FORBIDDEN`. Responds `204` on success.
 */
import { withAuth } from '@/lib/auth';
import { deleteFixedCommitmentHandler } from '@/services/profile';

export const DELETE = withAuth<{ params: { id: string } }>((request, ctx, routeContext) =>
    deleteFixedCommitmentHandler(request, ctx, routeContext),
);
