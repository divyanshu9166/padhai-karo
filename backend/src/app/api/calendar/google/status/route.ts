import { withAuth } from '@/lib/auth';
import { getGoogleCalendarStatusHandler } from '@/services/calendar';

export const GET = withAuth((request, auth) => getGoogleCalendarStatusHandler(request, auth));
