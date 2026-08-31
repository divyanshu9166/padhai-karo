import { withAuth } from '@/lib/auth';
import { getGoogleConnectUrlHandler } from '@/services/calendar';

export const GET = withAuth((request, auth) => getGoogleConnectUrlHandler(request, auth));
