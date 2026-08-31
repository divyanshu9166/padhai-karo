import { withAuth } from '@/lib/auth';
import { getPlanningOverviewHandler } from '@/services/planning';

export const GET = withAuth((request, auth) => getPlanningOverviewHandler(request, auth));
