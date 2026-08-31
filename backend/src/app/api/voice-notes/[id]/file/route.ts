import { withAuth } from '@/lib/auth';
import { getVoiceFileHandler } from '@/services/utilities';
import type { UtilityRouteContext } from '@/services/utilities';

export const GET = withAuth((request, auth, context) => getVoiceFileHandler(request, auth, context as UtilityRouteContext));
