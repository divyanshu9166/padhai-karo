import { withAuth } from '@/lib/auth';
import { addMistakeToRevisionHandler } from '@/services/mistake';

export const POST = withAuth((request, auth, context: { params: Promise<{ id: string }> }) =>
    context.params.then(({ id }) => addMistakeToRevisionHandler(request, auth, id)),
);
