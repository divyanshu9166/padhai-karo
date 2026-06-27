/**
 * PATCH /api/chapters/:id/status (task 5.1, design "Chapter / Syllabus Tracking Service").
 *
 * Updates a chapter's lifecycle status, accepting ONLY forward transitions along
 * NOT_STARTED → IN_PROGRESS → DONE → REVISED and rejecting backward/illegal ones with
 * 422 ILLEGAL_STATUS_TRANSITION (Req 12.1, 12.2). Guarded by {@link withAuth} (task 2.3):
 * unauthenticated requests are rejected with 401 before the handler runs, and the handler
 * asserts ownership of the targeted chapter (404/403) for per-user isolation.
 *
 * The dynamic `:id` segment is forwarded to the chapter service handler, which owns the
 * validation, ownership, transition-rule, and persistence logic.
 */
import { withAuth } from '@/lib/auth';
import { updateChapterStatusHandler } from '@/services/chapter';

type RouteContext = { params: { id: string } };

export const PATCH = withAuth<RouteContext>((request, auth, ctx) =>
    updateChapterStatusHandler(request, auth, ctx.params.id),
);
