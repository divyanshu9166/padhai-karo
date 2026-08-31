import { withAuth } from '@/lib/auth';
import { getNotificationPreferencesHandler, saveNotificationPreferencesHandler } from '@/services/notifications';

export const GET = withAuth((request, auth) => getNotificationPreferencesHandler(request, auth));
export const PUT = withAuth((request, auth) => saveNotificationPreferencesHandler(request, auth));
