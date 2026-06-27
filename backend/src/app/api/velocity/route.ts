/**
 * GET /api/velocity (task 10.2, design "Daily Time Audit / Study Velocity Service").
 *
 * Returns the authenticated user's Study_Velocity projection: the Target_Completion_Date
 * (Target_Exam_Date − Revision_Buffer), the projected syllabus completion date derived from
 * remaining pending-chapter estimated hours and the user's recent study rate, and whether
 * that projection is AHEAD of or BEHIND the target plus the whole-day difference (Req 14.6,
 * 14.7, 14.8). Guarded per the design "Authentication Posture": {@link withAuth} (task 2.3)
 * rejects unauthenticated requests with 401 UNAUTHORIZED before the handler runs, and the
 * handler scopes every query to the authenticated user for per-user isolation.
 *
 * The handler logic lives in the audit service so the route stays thin.
 */
import { withAuth } from '@/lib/auth';
import { getVelocityHandler } from '@/services/audit';

export const GET = withAuth((request, auth) => getVelocityHandler(request, auth));
