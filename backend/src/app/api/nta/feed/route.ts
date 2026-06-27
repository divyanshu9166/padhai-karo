/**
 * GET /api/nta/feed (task 17.2, design "NTA Update Feed (Worker + read API)").
 *
 * The track-filtered, chronological NTA Update Feed (Req 20.5). Guarded per the design
 * "Authentication Posture": the request must carry a valid `Authorization: Bearer <token>`
 * session, enforced by {@link withAuth} which rejects unauthenticated requests with
 * `401 UNAUTHORIZED` before the handler runs. The handler reads the user's Exam_Track from
 * their Profile and returns the matching stored announcements, most-recent-first.
 *
 * The handler logic lives in the NTA feed service so this route file stays framework-thin.
 */
import { withAuth } from '@/lib/auth';
import { ntaFeedHandler } from '@/services/nta/ntaFeedService';

export const GET = withAuth((request, ctx) => ntaFeedHandler(request, ctx));
