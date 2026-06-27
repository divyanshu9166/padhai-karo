/**
 * PATCH /api/profile/language (task 4.2, design "Onboarding / Profile Service").
 *
 * Persists the authenticated user's Language_Preference (Req 10.1). The guard
 * ({@link withAuth}) rejects unauthenticated requests with `401 UNAUTHORIZED` and scopes the
 * write to `ctx.user.id`. The handler returns `422` on an unsupported language value.
 */
import { withAuth } from '@/lib/auth';
import { updateLanguageHandler } from '@/services/profile';

export const PATCH = withAuth((request, ctx) => updateLanguageHandler(request, ctx));
