import { withAuth } from '@/lib/auth';
import { getTodayHandler } from '@/services/studyTasks';

export const GET = withAuth((request, auth) => getTodayHandler(request, auth));
