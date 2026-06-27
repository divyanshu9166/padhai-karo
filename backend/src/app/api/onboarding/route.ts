/**
 * POST /api/onboarding (task 4.1, design "Onboarding / Profile Service").
 *
 * A protected endpoint: the request must carry a valid `Authorization: Bearer <token>`
 * session. The guard ({@link withAuth}) rejects unauthenticated requests with
 * `401 UNAUTHORIZED` before the handler runs, and supplies the authenticated context so
 * all onboarding writes are scoped to `ctx.user.id`. The handler logic lives in the
 * Onboarding Service so this route file stays framework-thin.
 */
import { withAuth } from '@/lib/auth';
import { onboardingHandler } from '@/services/onboarding/onboardingService';

export const POST = withAuth((request, ctx) => onboardingHandler(request, ctx));
