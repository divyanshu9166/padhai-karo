import { withAuth } from '@/lib/auth';
import { reviewRevisionCardHandler } from '@/services/revision';

export const POST = withAuth((request, auth, context) => reviewRevisionCardHandler(request, auth, context as { params: { id: string } | Promise<{ id: string }> }));
