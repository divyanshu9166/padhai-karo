import { withAuth } from '@/lib/auth';
import { createExternalMockScoreHandler, listExternalMockScoresHandler } from '@/services/practice';

export const GET = withAuth((request, auth) => listExternalMockScoresHandler(request, auth));
export const POST = withAuth((request, auth) => createExternalMockScoreHandler(request, auth));
