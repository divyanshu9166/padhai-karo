/**
 * GET /api/allocation/signal (task 10.1, design "Service layer → `signalService.ts`").
 *
 * Returns the authenticated user's per-Chapter Combined_Weightage_Signal (Req 3.6, 10.1).
 * Guarded per the design "Authentication Posture": {@link withAuth} rejects unauthenticated
 * requests with 401 UNAUTHORIZED before the handler runs, and the handler scopes every query to
 * the authenticated user for per-user isolation.
 *
 * The handler logic lives in the signal service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { signalHandler } from '@/services/allocation/signalService';

export const GET = withAuth((request, auth) => signalHandler(request, auth));
