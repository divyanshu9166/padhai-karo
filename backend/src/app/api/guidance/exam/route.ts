import { withAuth } from '@/lib/auth';
import { getGuidanceHandler } from '@/services/upscc';

export const GET = withAuth((request, auth) => getGuidanceHandler(request, auth));
