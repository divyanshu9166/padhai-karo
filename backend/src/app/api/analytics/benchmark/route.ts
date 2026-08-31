import { withAuth } from '@/lib/auth';
import { getAnonymousBenchmarkHandler } from '@/services/analytics/benchmarkService';

export const GET = withAuth((request, auth) => getAnonymousBenchmarkHandler(request, auth));
