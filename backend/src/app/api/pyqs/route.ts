/**
 * GET /api/pyqs?year=&subjectId= (task 11.2, design "PYQ Practice + Scoring Service").
 *
 * Filtered PYQ practice listing. Guarded per the design "Authentication Posture": the
 * request must carry a valid `Authorization: Bearer <token>` session, enforced by
 * {@link withAuth} (task 2.3) which rejects unauthenticated requests with 401 UNAUTHORIZED
 * before the handler runs. The handler reads the user's Exam_Track from their Profile and
 * returns only year/subject/track-matching, non-flagged questions — without the answer
 * key (no `correctOption`). Available to all subscription tiers (Req 6.6/9.4): no gating.
 *
 * The handler logic lives in the PYQ service so it stays free of framework/guard concerns.
 */
import { withAuth } from '@/lib/auth';
import { pyqsHandler } from '@/services/pyq/pyqService';

export const GET = withAuth((request, ctx) => pyqsHandler(request, ctx));
