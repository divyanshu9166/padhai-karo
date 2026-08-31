import { withAuth } from '@/lib/auth';
import { createCommunityReportHandler } from '@/services/utilities';

export const POST = withAuth((request, auth) => createCommunityReportHandler(request, auth));
