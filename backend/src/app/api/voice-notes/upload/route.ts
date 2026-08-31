import { withAuth } from '@/lib/auth';
import { uploadVoiceNoteHandler } from '@/services/utilities';

export const POST = withAuth((request, auth) => uploadVoiceNoteHandler(request, auth));
