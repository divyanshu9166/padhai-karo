import { withAuth } from '@/lib/auth';
import { createAnxietyProtocolLogHandler } from '@/services/wellbeing';

export const POST = withAuth((request, auth) => createAnxietyProtocolLogHandler(request, auth));
