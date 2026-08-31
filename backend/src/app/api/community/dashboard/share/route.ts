import { withAuth } from '@/lib/auth';
import { shareDashboardHandler } from '@/services/utilities';

export const POST = withAuth((request, auth) => shareDashboardHandler(request, auth));
