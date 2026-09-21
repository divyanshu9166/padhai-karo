import { withAuth } from '@/lib/auth';
import { rescueBacklogHandler } from '@/services/studyTasks';

export const POST = withAuth((request, auth) => rescueBacklogHandler(request, auth));
