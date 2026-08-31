import { withAuth } from '@/lib/auth';
import { createOpenNoteHandler, listOpenNotesHandler } from '@/services/ai/openNotesService';

export const GET = withAuth((request, auth) => listOpenNotesHandler(request, auth));
export const POST = withAuth((request, auth) => createOpenNoteHandler(request, auth));
