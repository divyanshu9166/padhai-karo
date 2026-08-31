import { withAuth } from '@/lib/auth';
import { listCurrentAffairsBookmarksHandler } from '@/services/currentAffairs';

export const GET = withAuth((request, auth) => listCurrentAffairsBookmarksHandler(request, auth));
