import { withAuth } from '@/lib/auth';
import { createRevisionCardHandler, listRevisionCardsHandler } from '@/services/revision';

export const GET = withAuth((request, auth) => listRevisionCardsHandler(request, auth));
export const POST = withAuth((request, auth) => createRevisionCardHandler(request, auth));
