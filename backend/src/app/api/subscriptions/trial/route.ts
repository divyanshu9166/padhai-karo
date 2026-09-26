/**
 * POST /api/subscriptions/trial — start the one-time 7-day premium trial (no payment).
 * Guarded by {@link withAuth}; see {@link startTrialHandler}.
 */
import { withAuth } from '@/lib/auth';
import { startTrialHandler } from '@/services/subscription';

export const POST = withAuth((request, auth) => startTrialHandler(request, auth));
