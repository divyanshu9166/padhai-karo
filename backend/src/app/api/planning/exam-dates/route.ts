import { withAuth } from '@/lib/auth';
import { createExamDateHandler, listExamDatesHandler } from '@/services/planning';

export const GET = withAuth((request, auth) => listExamDatesHandler(request, auth));
export const POST = withAuth((request, auth) => createExamDateHandler(request, auth));
