import { withAuth } from '@/lib/auth';
import { getRevisionScheduleHandler } from '@/services/revision';

export const GET = withAuth((request, auth) => getRevisionScheduleHandler(request, auth));
