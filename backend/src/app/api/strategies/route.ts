import { withAuth } from '@/lib/auth';
import { createStrategyHandler, listStrategiesHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => listStrategiesHandler(request, auth));
export const POST = withAuth((request, auth) => createStrategyHandler(request, auth));
