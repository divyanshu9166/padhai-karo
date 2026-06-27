/**
 * /api/timetable/buffer-policy (design "Timetable Generation Service"; Req 15.4).
 *
 * PATCH persists the user's choice of how unused buffer slots convert at week end —
 * `CATCH_UP` or `EXTRA_REVISION` — on their Profile. An invalid value is rejected with
 * `422 VALIDATION_ERROR`. The handler is wrapped by {@link withAuth} (task 2.3), so a request
 * without a valid `Authorization: Bearer <token>` session is rejected with `401 UNAUTHORIZED`
 * before it runs; the update is scoped to the authenticated user.
 */
import { withAuth } from '@/lib/auth';
import { updateBufferPolicyHandler } from '@/services/timetable';

export const PATCH = withAuth((request, auth) => updateBufferPolicyHandler(request, auth));
