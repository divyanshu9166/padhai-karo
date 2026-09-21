import { withAuth } from '@/lib/auth';
import { getImprovementForecastHandler } from '@/services/analytics/improvementForecastService';

export const GET = withAuth((request, auth) => getImprovementForecastHandler(request, auth));
