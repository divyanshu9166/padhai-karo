import { withAuth } from '@/lib/auth';
import { createCapsuleHandler, listCapsulesHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => listCapsulesHandler(request, auth));
export const POST = withAuth((request, auth) => createCapsuleHandler(request, auth));
