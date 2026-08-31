import { withAuth } from '@/lib/auth';
import { createBuddyRequestHandler, listBuddiesHandler } from '@/services/utilities';

export const GET = withAuth((request, auth) => listBuddiesHandler(request, auth));
export const POST = withAuth((request, auth) => createBuddyRequestHandler(request, auth));
