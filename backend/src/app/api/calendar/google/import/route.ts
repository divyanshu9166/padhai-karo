import { withAuth } from '@/lib/auth';
import { importGoogleCalendarHandler } from '@/services/calendar';

export const POST = withAuth((request, auth) => importGoogleCalendarHandler(request, auth));
