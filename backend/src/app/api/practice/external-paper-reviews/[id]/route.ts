import { withAuth } from '@/lib/auth';
import { deleteExternalPaperReviewHandler, getExternalPaperReviewHandler } from '@/services/practice';

type RouteContext = { params: { id: string } | Promise<{ id: string }> };

export const GET = withAuth((request, auth, context) => getExternalPaperReviewHandler(request, auth, context as RouteContext));
export const DELETE = withAuth((request, auth, context) => deleteExternalPaperReviewHandler(request, auth, context as RouteContext));
