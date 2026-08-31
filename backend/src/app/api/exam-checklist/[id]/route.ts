import { withAuth } from '@/lib/auth';
import { updateChecklistHandler } from '@/services/learning';

export const PATCH = withAuth((request, auth, context) => updateChecklistHandler(request, auth, context as { params: { id: string } | Promise<{ id: string }> }));
