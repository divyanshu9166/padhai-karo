import { withAuth } from '@/lib/auth';
import { getWeeklyReviewHandler } from '@/services/studyTasks';

export const GET = withAuth((request, auth) => getWeeklyReviewHandler(request, auth));
