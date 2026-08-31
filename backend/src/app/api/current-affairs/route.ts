import { withAuth } from '@/lib/auth';
import { createCurrentAffairsBookmarkHandler, listCurrentAffairsHandler } from '@/services/currentAffairs';

export const GET = withAuth((request, auth) => listCurrentAffairsHandler(request, auth));
export const POST = withAuth((request, auth) => createCurrentAffairsBookmarkHandler(request, auth));
