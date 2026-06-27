/**
 * GET /api/admin/pyq-extraction/jobs/:id (task 12.2, design "PYQ Extraction Pipeline
 * (Worker, Req 7)").
 *
 * Operator endpoint returning a job's { status, produced, flaggedForReview } by reading the
 * BullMQ job state and return value; 404 NOT_FOUND when no such job exists. Guarded by
 * {@link withAuth} (task 2.3): unauthenticated requests are rejected with 401 UNAUTHORIZED
 * before the handler runs. These are operator/admin endpoints; an authenticated session is
 * required for now (see the TODO(admin-role) note in the service for the future role check).
 *
 * The framework forwards the dynamic `:id` segment as the route context's `params.id`,
 * which `withAuth` passes through to the handler as its third argument.
 */
import { withAuth } from '@/lib/auth';
import type { PyqExtractionJobRouteContext } from '@/services/pyqExtractionAdmin';
import { getPyqExtractionJobHandler } from '@/services/pyqExtractionAdmin';

export const GET = withAuth<PyqExtractionJobRouteContext>((request, ctx, routeContext) =>
    getPyqExtractionJobHandler(request, ctx, routeContext),
);
