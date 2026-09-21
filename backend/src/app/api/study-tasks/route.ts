import { withAuth } from '@/lib/auth';
import { createStudyTaskHandler, listStudyTasksHandler } from '@/services/studyTasks';

export const GET = withAuth((request, auth) => listStudyTasksHandler(request, auth));
export const POST = withAuth((request, auth) => createStudyTaskHandler(request, auth));
