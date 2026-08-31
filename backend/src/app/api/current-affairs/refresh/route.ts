import { withAuth } from '@/lib/auth';
import { refreshCurrentAffairsHandler } from '@/services/currentAffairs';

export const POST = withAuth((request, auth) => refreshCurrentAffairsHandler(request, auth));
