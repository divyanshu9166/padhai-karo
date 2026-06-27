/**
 * GET /api/syllabus/completion (task 5.3, design "Chapter / Syllabus Tracking Service").
 *
 * Returns the authenticated user's syllabus completion percent — chapters with status
 * DONE or REVISED over the total chapter count, 0 when there are no chapters (Req 12.4,
 * 12.5). Guarded per the design "Authentication Posture": {@link withAuth} (task 2.3)
 * rejects unauthenticated requests with 401 UNAUTHORIZED before the handler runs, and the
 * handler scopes its query to the authenticated user for per-user isolation.
 *
 * The handler logic lives in the chapter service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { getSyllabusCompletionHandler } from '@/services/chapter';

export const GET = withAuth((request, auth) => getSyllabusCompletionHandler(request, auth));
