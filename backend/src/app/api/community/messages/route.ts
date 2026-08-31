import { withAuth } from '@/lib/auth';
import { createCommunityMessageHandler, listCommunityMessagesHandler } from '@/services/utilities';

export const GET = withAuth((request, auth) => listCommunityMessagesHandler(request, auth));
export const POST = withAuth((request, auth) => createCommunityMessageHandler(request, auth));
