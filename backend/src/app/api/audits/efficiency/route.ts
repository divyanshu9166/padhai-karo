/**
 * GET /api/audits/efficiency (task 10.2, design "Daily Time Audit / Study Velocity Service").
 *
 * Returns the authenticated user's Efficiency_Score — total actual minutes over total
 * planned minutes across their whole Daily_Time_Audit history, or 1 when there is no history
 * / zero planned time (Req 14.4). Guarded per the design "Authentication Posture":
 * {@link withAuth} (task 2.3) rejects unauthenticated requests with 401 UNAUTHORIZED before
 * the handler runs, and the handler scopes its query to the authenticated user for per-user
 * isolation.
 *
 * The handler logic lives in the audit service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { getEfficiencyHandler } from '@/services/audit';

export const GET = withAuth((request, auth) => getEfficiencyHandler(request, auth));
