import { withAuth } from '@/lib/auth';
import { getPdfFileHandler } from '@/services/utilities';
import type { UtilityRouteContext } from '@/services/utilities';

export const GET = withAuth((request, auth, context) => getPdfFileHandler(request, auth, context as UtilityRouteContext));
