import { withAuth } from '@/lib/auth';
import { updateDoubtHandler } from '@/services/learning';

export const PATCH = withAuth((request, auth, context) => updateDoubtHandler(request, auth, context as { params: { id: string } | Promise<{ id: string }> }));
