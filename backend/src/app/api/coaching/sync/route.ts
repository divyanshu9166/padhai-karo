import { withAuth } from '@/lib/auth';
import { syncCoachingConnectionHandler } from '@/services/learning';

export const POST = withAuth((request, auth) => syncCoachingConnectionHandler(request, auth));
