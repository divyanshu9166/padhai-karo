import { withAuth } from '@/lib/auth';
import { createAnswerWritingHandler, listAnswerWritingHandler } from '@/services/practice';

export const GET = withAuth((request, auth) => listAnswerWritingHandler(request, auth));
export const POST = withAuth((request, auth) => createAnswerWritingHandler(request, auth));
