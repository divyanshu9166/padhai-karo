import { withAuth } from '@/lib/auth';
import { createCommunityPostHandler, listCommunityPostsHandler } from '@/services/utilities';

export const GET = withAuth((request, auth) => listCommunityPostsHandler(request, auth));
export const POST = withAuth((request, auth) => createCommunityPostHandler(request, auth));
