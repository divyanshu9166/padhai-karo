/**
 * /api/analytics/mock-scores (task 26.1, design "External Mock Score endpoints (Req 1)";
 * Req 1.1, 1.5, 14.1).
 *
 * POST records a new External_Mock_Score for the authenticated user (Req 1.1). GET lists the
 * authenticated user's mock scores, most-recent test date first; always user-scoped (Req 14.1).
 *
 * Both handlers are wrapped by the session-validation guard ({@link withAuth}), which enforces
 * the design "Authentication Posture": the request must carry a valid `Authorization: Bearer
 * <token>` session, otherwise it is rejected with `401 UNAUTHORIZED` before the handler runs.
 * The handler logic lives in the External Mock Score service so it stays free of
 * framework/guard concerns.
 */
import { withAuth } from '@/lib/auth';
import {
    createMockScoreHandler,
    listMockScoresHandler,
} from '@/services/analytics/mockScoreService';

export const POST = withAuth((request, auth) => createMockScoreHandler(request, auth));

export const GET = withAuth((request, auth) => listMockScoresHandler(request, auth));
