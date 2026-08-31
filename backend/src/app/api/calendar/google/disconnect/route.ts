import { withAuth } from '@/lib/auth';
import { disconnectGoogleCalendarHandler } from '@/services/calendar';

export const DELETE = withAuth((request, auth) => disconnectGoogleCalendarHandler(request, auth));
