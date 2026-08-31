import { withAuth } from '@/lib/auth';
import { createRecallDrillAttemptHandler } from '@/services/learning';

export const POST = withAuth((request, auth) => createRecallDrillAttemptHandler(request, auth));
