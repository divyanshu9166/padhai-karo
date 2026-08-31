import { withAuth } from '@/lib/auth';
import { getWidgetSummaryHandler } from '@/services/upscc';

export const GET = withAuth((request, auth) => getWidgetSummaryHandler(request, auth));
