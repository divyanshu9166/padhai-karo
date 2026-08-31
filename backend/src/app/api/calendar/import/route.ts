import { withAuth } from '@/lib/auth';
import { importCalendarEventsHandler } from '@/services/calendar';

export const POST = withAuth((request, auth) => importCalendarEventsHandler(request, auth));
