import { withAuth } from '@/lib/auth';
import { updateBuddyHandler, type UtilityRouteContext } from '@/services/utilities';

export const PATCH = withAuth<UtilityRouteContext>((request, auth, context) => updateBuddyHandler(request, auth, context));
