import { withAuth } from '@/lib/auth';
import { getMockHistoryHandler, startMockExamHandler } from '@/services/practice';

export const GET = withAuth((request, auth) => getMockHistoryHandler(request, auth));
export const POST = withAuth((request, auth) => startMockExamHandler(request, auth));
