import { withAuth } from '@/lib/auth';
import { getDailyBriefingHandler, refreshDailyBriefingHandler } from '@/services/briefing';

export const GET = withAuth((request, auth) => getDailyBriefingHandler(request, auth));
export const POST = withAuth((request, auth) => refreshDailyBriefingHandler(request, auth));
