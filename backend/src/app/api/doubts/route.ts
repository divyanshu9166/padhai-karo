import { withAuth } from '@/lib/auth';
import { createDoubtHandler, exportDoubtsHandler, listDoubtsHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => new URL(request.url).searchParams.get('format') === 'csv' ? exportDoubtsHandler(request, auth) : listDoubtsHandler(request, auth));
export const POST = withAuth((request, auth) => createDoubtHandler(request, auth));
