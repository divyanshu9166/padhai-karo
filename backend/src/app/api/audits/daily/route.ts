/**
 * POST /api/audits/daily (task 10.1, design "Daily Time Audit / Study Velocity Service").
 *
 * Records the authenticated user's end-of-day check-in: planned vs actual study minutes for
 * a day, where the actual value is derived from that day's focus sessions when present and
 * otherwise from the user-entered figure (Req 14.1, 14.2, 14.3). Guarded per the design
 * "Authentication Posture": {@link withAuth} (task 2.3) rejects unauthenticated requests
 * with 401 UNAUTHORIZED before the handler runs, and the handler scopes every read and write
 * to the authenticated user for per-user isolation.
 *
 * The handler logic lives in the audit service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { recordDailyAuditHandler } from '@/services/audit';

export const POST = withAuth((request, auth) => recordDailyAuditHandler(request, auth));
