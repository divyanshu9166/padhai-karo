import { withAuth } from '@/lib/auth';
import { simulateStrategyHandler } from '@/services/upscc';

export const POST = withAuth((request) => simulateStrategyHandler(request));
