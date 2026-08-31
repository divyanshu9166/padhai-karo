import { withAuth } from '@/lib/auth';
import { listOfflineMutationFailuresHandler, offlineMutationsHandler } from '@/services/sync';

export const GET = withAuth((request, auth) => listOfflineMutationFailuresHandler(request, auth));
export const POST = withAuth((request, auth) => offlineMutationsHandler(request, auth));
