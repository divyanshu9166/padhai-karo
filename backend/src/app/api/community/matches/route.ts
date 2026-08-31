import { withAuth } from '@/lib/auth';
import { listBuddyMatchesHandler } from '@/services/utilities';

export const GET = withAuth((request, auth) => listBuddyMatchesHandler(request, auth));
