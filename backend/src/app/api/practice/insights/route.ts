import { withAuth } from '@/lib/auth';
import { getPracticeInsightsHandler } from '@/services/practice';

export const GET = withAuth((request, auth) => getPracticeInsightsHandler(request, auth));
