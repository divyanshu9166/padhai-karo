import { withAuth } from '@/lib/auth';
import { createCardsFromNoteHandler } from '@/services/revision';

export const POST = withAuth((request, auth) => createCardsFromNoteHandler(request, auth));
