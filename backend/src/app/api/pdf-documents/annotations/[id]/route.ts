import { withAuth } from '@/lib/auth';
import { deleteAnnotationHandler, updateAnnotationHandler } from '@/services/learning';

type AnnotationRouteContext = { params: { id: string } | Promise<{ id: string }> };
export const PATCH = withAuth((request, auth, context) => updateAnnotationHandler(request, auth, context as AnnotationRouteContext));
export const DELETE = withAuth((request, auth, context) => deleteAnnotationHandler(request, auth, context as AnnotationRouteContext));
