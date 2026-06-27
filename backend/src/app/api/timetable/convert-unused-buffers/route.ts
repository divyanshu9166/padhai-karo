/**
 * /api/timetable/convert-unused-buffers (design "Adaptive Rebalancer" step 3; Req 15.5).
 *
 * POST runs the end-of-week conversion of any still-reserved `Buffer_Slot`s for the named
 * week into the user's chosen CATCH_UP/EXTRA_REVISION option (Req 15.4/15.5). It is exposed as
 * an explicit endpoint so the conversion can be triggered when the week closes. The handler is
 * wrapped by {@link withAuth} (task 2.3), so a request without a valid
 * `Authorization: Bearer <token>` session is rejected with `401 UNAUTHORIZED` before it runs;
 * every read/write is scoped to the authenticated user.
 */
import { withAuth } from '@/lib/auth';
import { convertUnusedBuffersHandler } from '@/services/timetable';

export const POST = withAuth((request, auth) => convertUnusedBuffersHandler(request, auth));
