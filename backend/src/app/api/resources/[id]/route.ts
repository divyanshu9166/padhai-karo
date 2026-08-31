import { withAuth } from '@/lib/auth';
import { deleteResourceHandler, updateResourceHandler } from '@/services/utilities';
import type { UtilityRouteContext } from '@/services/utilities';

export const PATCH = withAuth((request, auth, context: UtilityRouteContext) => updateResourceHandler(request, auth, context));
export const DELETE = withAuth((request, auth, context: UtilityRouteContext) => deleteResourceHandler(request, auth, context));
