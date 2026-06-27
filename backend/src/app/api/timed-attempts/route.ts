/**
 * POST /api/timed-attempts (task 13.1, design "Timed Paper Mode Service").
 *
 * Submits a Timed Paper attempt for the authenticated user. Guarded per the design
 * "Authentication Posture": the request must carry a valid `Authorization: Bearer <token>`
 * session, enforced by {@link withAuth} (task 2.3) which rejects unauthenticated requests
 * with 401 UNAUTHORIZED before the handler runs. The handler resolves the answer key
 * server-side from the paper's stored PYQ rows, scores EVERY question via the shared pure
 * scoring function (unanswered/unreached counted incorrect), and persists the attempt
 * scoped to the authenticated user.
 *
 * The handler logic lives in the Timed Paper service so it stays free of framework/guard
 * concerns.
 */
import { withAuth } from '@/lib/auth';
import { createTimedAttemptHandler } from '@/services/timedPaper';

export const POST = withAuth((request, ctx) => createTimedAttemptHandler(request, ctx));
