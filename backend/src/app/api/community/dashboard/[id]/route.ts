import { withAuth } from '@/lib/auth';
import { getSharedDashboardHandler, type UtilityRouteContext } from '@/services/utilities';

export const GET = withAuth<UtilityRouteContext>((request, auth, context) => getSharedDashboardHandler(request, auth, context));
