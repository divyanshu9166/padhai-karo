/**
 * POST /api/profile/fixed-commitments (task 4.2, design "Onboarding / Profile Service").
 *
 * Creates a single Fixed_Commitment for the authenticated user (Req 2.1). The guard
 * ({@link withAuth}) rejects unauthenticated requests with `401 UNAUTHORIZED` and scopes the
 * write to `ctx.user.id`. The handler returns `422` when the commitment end time is not
 * later than its start time, or any field is malformed (Req 2.3).
 */
import { withAuth } from '@/lib/auth';
import { createFixedCommitmentHandler } from '@/services/profile';

export const POST = withAuth((request, ctx) => createFixedCommitmentHandler(request, ctx));
