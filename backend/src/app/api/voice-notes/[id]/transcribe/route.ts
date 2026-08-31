import { withAuth } from '@/lib/auth';
import { transcribeVoiceNoteHandler } from '@/services/utilities';
import type { UtilityRouteContext } from '@/services/utilities';

export const POST = withAuth((request, auth, context) => transcribeVoiceNoteHandler(request, auth, context as UtilityRouteContext));
