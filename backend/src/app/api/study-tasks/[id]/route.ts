import { withAuth } from '@/lib/auth';
import { updateStudyTaskHandler } from '@/services/studyTasks';

export const PATCH = withAuth((request, auth, context: { params: Promise<{ id: string }> }) =>
    context.params.then(({ id }) => updateStudyTaskHandler(request, auth, id)),
);
