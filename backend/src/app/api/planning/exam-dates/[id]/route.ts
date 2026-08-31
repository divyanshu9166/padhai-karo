import { withAuth } from '@/lib/auth';
import { deleteExamDateHandler } from '@/services/planning';
import type { ExamDateRouteContext } from '@/services/planning';

export const DELETE = withAuth((request, auth, context: ExamDateRouteContext) => deleteExamDateHandler(request, auth, context));
