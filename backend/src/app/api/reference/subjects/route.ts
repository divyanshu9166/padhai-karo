/**
 * GET /api/reference/subjects?track=JEE|NEET (task 3.2, design "Reference Data Service").
 *
 * Reference reads are authenticated per the design "Authentication Posture": the request
 * must carry a valid `Authorization: Bearer <token>` session. The session-validation
 * guard ({@link withAuth}, task 2.3) enforces this and rejects unauthenticated requests
 * with `401 UNAUTHORIZED` before the handler runs. The handler logic itself lives in the
 * Reference Data Service so it stays free of framework/middleware concerns.
 */
import { withAuth } from '@/lib/auth';
import { subjectsHandler } from '@/services/reference/referenceService';

export const GET = withAuth((request) => subjectsHandler(request));
