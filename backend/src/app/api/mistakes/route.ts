/**
 * /api/mistakes (task 14.1, design "Mistake Journal Service", Req 18).
 *
 * POST flags a wrong/explicitly-flagged question into the categorized Mistake Journal,
 * upserting on `(userId, questionId)` so a re-flag updates rather than duplicates (Req 18.4).
 * GET lists the authenticated user's journal entries, filtered by `subjectId` and/or
 * `category` when provided (Req 18.5/18.6).
 *
 * Both handlers are wrapped by the session-validation guard ({@link withAuth}, task 2.3),
 * which enforces the design "Authentication Posture": the request must carry a valid
 * `Authorization: Bearer <token>` session, otherwise it is rejected with `401 UNAUTHORIZED`
 * before the handler runs. Each handler then scopes its work to the authenticated user
 * (Req 18.7). The handler logic lives in the Mistake Journal service so it stays free of
 * framework/guard concerns.
 */
import { withAuth } from '@/lib/auth';
import { flagMistakeHandler, listMistakesHandler } from '@/services/mistake';

export const POST = withAuth((request, auth) => flagMistakeHandler(request, auth));

export const GET = withAuth((request, auth) => listMistakesHandler(request, auth));
