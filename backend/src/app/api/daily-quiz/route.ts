/**
 * GET /api/daily-quiz — today's 10-question PYQ quiz (India date) and the quiz streak.
 * Guarded by {@link withAuth}; see {@link getDailyQuizHandler}.
 */
import { withAuth } from '@/lib/auth';
import { getDailyQuizHandler } from '@/services/dailyQuiz';

export const dynamic = 'force-dynamic';

export const GET = withAuth((request, auth) => getDailyQuizHandler(request, auth));
