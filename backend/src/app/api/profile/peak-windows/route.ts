/**
 * PATCH /api/profile/peak-windows (task 4.2, design "Onboarding / Profile Service").
 *
 * Persists the authenticated user's Peak_Focus_Windows (Req 2.8). The guard
 * ({@link withAuth}) rejects unauthenticated requests with `401 UNAUTHORIZED` and scopes the
 * write to `ctx.user.id`. The handler validates and de-dupes the window set, returning `422`
 * on an unsupported value.
 */
import { withAuth } from '@/lib/auth';
import { updatePeakWindowsHandler } from '@/services/profile';

export const PATCH = withAuth((request, ctx) => updatePeakWindowsHandler(request, ctx));
