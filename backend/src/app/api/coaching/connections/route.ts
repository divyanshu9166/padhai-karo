import { withAuth } from '@/lib/auth';
import { createCoachingConnectionHandler, listCoachingConnectionsHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => listCoachingConnectionsHandler(request, auth));
export const POST = withAuth((request, auth) => createCoachingConnectionHandler(request, auth));
