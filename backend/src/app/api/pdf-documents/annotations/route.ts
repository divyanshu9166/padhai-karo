import { withAuth } from '@/lib/auth';
import { createAnnotationHandler, listAnnotationsHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => listAnnotationsHandler(request, auth));
export const POST = withAuth((request, auth) => createAnnotationHandler(request, auth));
