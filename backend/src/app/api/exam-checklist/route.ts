import { withAuth } from '@/lib/auth';
import { listChecklistHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => listChecklistHandler(request, auth));
