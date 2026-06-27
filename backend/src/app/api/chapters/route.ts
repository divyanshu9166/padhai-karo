/**
 * GET /api/chapters (task 5.1, design "Chapter / Syllabus Tracking Service").
 *
 * Returns the authenticated user's chapters with status, weightage, estimated hours, and
 * overrides. Guarded per the design "Authentication Posture": {@link withAuth} (task 2.3)
 * rejects unauthenticated requests with 401 UNAUTHORIZED before the handler runs, and the
 * handler scopes its query to the authenticated user for per-user isolation.
 *
 * The handler logic lives in the chapter service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { listChaptersHandler } from '@/services/chapter';

export const GET = withAuth((request, auth) => listChaptersHandler(request, auth));
