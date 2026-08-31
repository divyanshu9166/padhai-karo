import { withAuth } from '@/lib/auth';
import { createResourceHandler, listResourcesHandler } from '@/services/utilities';

export const GET = withAuth((request, auth) => listResourcesHandler(request, auth));
export const POST = withAuth((request, auth) => createResourceHandler(request, auth));
