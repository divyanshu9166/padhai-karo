import { withAuth } from '@/lib/auth';
import { createExternalPaperReviewHandler, listExternalPaperReviewsHandler } from '@/services/practice';

export const GET = withAuth((request, auth) => listExternalPaperReviewsHandler(request, auth));
export const POST = withAuth((request, auth) => createExternalPaperReviewHandler(request, auth));
