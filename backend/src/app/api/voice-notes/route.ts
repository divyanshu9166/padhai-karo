import { withAuth } from '@/lib/auth';
import { createVoiceNoteHandler, listVoiceNotesHandler } from '@/services/utilities';

export const GET = withAuth((request, auth) => listVoiceNotesHandler(request, auth));
export const POST = withAuth((request, auth) => createVoiceNoteHandler(request, auth));
