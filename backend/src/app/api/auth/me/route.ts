/**
 * GET /api/auth/me — return the authenticated user and onboarding completeness
 * (Req 1.7; design "Auth Service").
 *
 * This endpoint uses the shared session-validation guard ({@link withAuth}, task 2.3),
 * the same mechanism every protected endpoint adopts. The guard validates the
 * `Authorization: Bearer <token>` session and rejects missing/invalid/expired tokens with
 * `401 UNAUTHORIZED` (Req 1.7), then hands the resolved user to the handler.
 *
 * Outcomes:
 *   - `200 { user, profileComplete }` on success. `profileComplete` reflects whether the
 *     user has a Profile that has finished onboarding (`Profile.onboardingComplete`); it
 *     is `false` when no profile exists yet.
 *   - `401 UNAUTHORIZED` when the bearer token is missing, unknown, or expired (Req 1.7).
 *
 * `user` is shaped through the safe projection, so `passwordHash` is never returned.
 */
import { toPublicUser, withAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const GET = withAuth(async (_request, { user }) => {
    const profile = await prisma.profile.findUnique({
        where: { userId: user.id },
        select: { onboardingComplete: true },
    });

    return Response.json({
        user: toPublicUser(user),
        profileComplete: profile?.onboardingComplete ?? false,
    });
});
