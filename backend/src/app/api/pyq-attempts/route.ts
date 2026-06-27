/**
 * POST /api/pyq-attempts (task 11.3, design "PYQ Practice + Scoring Service").
 *
 * Submits a PYQ attempt for the authenticated user. Guarded per the design "Authentication
 * Posture": the request must carry a valid `Authorization: Bearer <token>` session,
 * enforced by {@link withAuth} (task 2.3) which rejects unauthenticated requests with
 * 401 UNAUTHORIZED before the handler runs. The handler resolves the answer key
 * server-side from the stored PYQ rows, scores via the shared pure scoring function, and
 * persists the attempt scoped to the authenticated user. Available to all subscription
 * tiers (Req 6.6/9.4): no gating.
 *
 * The handler logic lives in the PYQ attempt service so it stays free of framework/guard
 * concerns.
 */
import { withAuth } from '@/lib/auth';
import { createPyqAttemptHandler } from '@/services/pyq/pyqAttemptService';

export const POST = withAuth((request, ctx) => createPyqAttemptHandler(request, ctx));
