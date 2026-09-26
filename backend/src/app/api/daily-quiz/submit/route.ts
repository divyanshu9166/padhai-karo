/**
 * POST /api/daily-quiz/submit — grade today's quiz once and turn misses into revision cards.
 * Guarded by {@link withAuth}; see {@link submitDailyQuizHandler}.
 */
import { withAuth } from '@/lib/auth';
import { submitDailyQuizHandler } from '@/services/dailyQuiz';

export const POST = withAuth((request, auth) => submitDailyQuizHandler(request, auth));
