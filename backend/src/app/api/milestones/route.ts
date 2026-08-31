import { withAuth } from '@/lib/auth';
import { getMilestonesHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => getMilestonesHandler(request, auth));
