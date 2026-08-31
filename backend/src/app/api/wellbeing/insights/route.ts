import { withAuth } from '@/lib/auth';
import { getWellbeingInsightsHandler } from '@/services/wellbeing';

export const GET = withAuth((request, auth) => getWellbeingInsightsHandler(request, auth));
