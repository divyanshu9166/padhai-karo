/**
 * /api/focus-sessions (design "Focus Timer / Session Service").
 *
 * POST (task 8.1) records a completed focus session for the authenticated user. GET
 * (task 8.2) lists the authenticated user's sessions, optionally bounded by a `from`/`to`
 * range over `startTime`.
 *
 * Both handlers are wrapped by the session-validation guard ({@link withAuth}, task 2.3),
 * which enforces the design "Authentication Posture": the request must carry a valid
 * `Authorization: Bearer <token>` session, otherwise it is rejected with `401 UNAUTHORIZED`
 * before the handler runs. Each handler then scopes its work to the authenticated user
 * (Req 4.3, 4.5, 4.7, 4.8).
 */
import { withAuth } from '@/lib/auth';
import { listFocusSessionsHandler, recordFocusSessionHandler } from '@/services/focus';

export const POST = withAuth((request, auth) => recordFocusSessionHandler(request, auth));

export const GET = withAuth((request, auth) => listFocusSessionsHandler(request, auth));
