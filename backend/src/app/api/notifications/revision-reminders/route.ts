import { withAuth } from '@/lib/auth';
import { sendRevisionRemindersHandler } from '@/services/notifications';

export const POST = withAuth((request, auth) => sendRevisionRemindersHandler(request, auth));
