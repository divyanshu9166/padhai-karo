import { withAuth } from '@/lib/auth';
import { saveMockExamHandler, submitMockExamHandler } from '@/services/practice';

export const PATCH = withAuth((request, auth, context) => saveMockExamHandler(request, auth, context as { params: { id: string } | Promise<{ id: string }> }));
export const POST = withAuth((request, auth, context) => submitMockExamHandler(request, auth, context as { params: { id: string } | Promise<{ id: string }> }));
