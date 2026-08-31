import { listCommunityReportsAdminHandler, updateCommunityReportAdminHandler } from '@/services/utilities';

export const GET = (request: Request) => listCommunityReportsAdminHandler(request);
export const PATCH = (request: Request) => updateCommunityReportAdminHandler(request);
