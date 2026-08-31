import { withAuth } from '@/lib/auth';
import { createRecoveryPlanHandler } from '@/services/wellbeing';

export const POST = withAuth((request, auth) => createRecoveryPlanHandler(request, auth));
