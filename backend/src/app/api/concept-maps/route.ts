import { withAuth } from '@/lib/auth';
import { createConceptMapHandler, listConceptMapsHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => listConceptMapsHandler(request, auth));
export const POST = withAuth((request, auth) => createConceptMapHandler(request, auth));
