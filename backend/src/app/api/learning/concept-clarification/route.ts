import { withAuth } from '@/lib/auth';
import { createConceptClarificationHandler } from '@/services/learning';

export const POST = withAuth((request, auth) => createConceptClarificationHandler(request, auth));
