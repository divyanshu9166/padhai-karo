/**
 * PATCH & DELETE /api/chapters/:id/override (task 5.2, design "Chapter / Syllabus Tracking
 * Service").
 *
 * PATCH persists the provided weightage/estHours/timeAllocation overrides on the chapter
 * (Req 11.3); DELETE clears all overrides back to null (Req 11.4). Both are guarded by
 * {@link withAuth} (task 2.3): unauthenticated requests are rejected with 401 before the
 * handler runs, and the handlers assert ownership of the targeted chapter (404/403) for
 * per-user isolation.
 *
 * The dynamic `:id` segment is forwarded to the chapter override service handlers, which
 * own the validation, ownership, and persistence logic. Overrides persist on the Chapter
 * row and are read back by the timetable generator (task 6.2).
 */
import { withAuth } from '@/lib/auth';
import {
    clearChapterOverrideHandler,
    updateChapterOverrideHandler,
} from '@/services/chapter';

type RouteContext = { params: { id: string } | Promise<{ id: string }> };

export const PATCH = withAuth<RouteContext>(async (request, auth, ctx) =>
    updateChapterOverrideHandler(request, auth, (await ctx.params).id),
);

export const DELETE = withAuth<RouteContext>(async (request, auth, ctx) =>
    clearChapterOverrideHandler(request, auth, (await ctx.params).id),
);
