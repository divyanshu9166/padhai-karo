import { withAuth } from '@/lib/auth';
import { listWellbeingCheckinsHandler, saveWellbeingCheckinHandler } from '@/services/planning';

export const GET = withAuth((request, auth) => listWellbeingCheckinsHandler(request, auth));
export const POST = withAuth((request, auth) => saveWellbeingCheckinHandler(request, auth));
