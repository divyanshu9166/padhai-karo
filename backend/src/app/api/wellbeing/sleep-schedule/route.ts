import { withAuth } from '@/lib/auth';
import { getSleepScheduleHandler, saveSleepScheduleHandler } from '@/services/planning';

export const GET = withAuth((request, auth) => getSleepScheduleHandler(request, auth));
export const PUT = withAuth((request, auth) => saveSleepScheduleHandler(request, auth));
