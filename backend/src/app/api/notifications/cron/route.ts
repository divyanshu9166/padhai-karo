import { sendScheduledRevisionRemindersHandler } from '@/services/notifications';

export const POST = (request: Request) => sendScheduledRevisionRemindersHandler(request);
export const GET = (request: Request) => sendScheduledRevisionRemindersHandler(request);
