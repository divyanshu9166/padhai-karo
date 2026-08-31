import { withAuth } from '@/lib/auth';
import { createPacingAttemptHandler, listPacingAttemptsHandler } from '@/services/practice';

export const GET = withAuth((request, auth) => listPacingAttemptsHandler(request, auth));
export const POST = withAuth((request, auth) => createPacingAttemptHandler(request, auth));
