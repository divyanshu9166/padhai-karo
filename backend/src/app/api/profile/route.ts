/**
 * GET /api/profile (task 4.2, design "Onboarding / Profile Service").
 *
 * A protected endpoint: the session-validation guard ({@link withAuth}) rejects
 * unauthenticated requests with `401 UNAUTHORIZED` and supplies the authenticated context
 * so the read is scoped to `ctx.user.id`. The handler logic lives in the Profile Service so
 * this route file stays framework-thin.
 */
import { withAuth } from '@/lib/auth';
import { getProfileHandler } from '@/services/profile';

export const GET = withAuth((request, ctx) => getProfileHandler(request, ctx));
