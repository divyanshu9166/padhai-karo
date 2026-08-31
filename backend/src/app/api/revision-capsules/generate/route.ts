import { withAuth } from '@/lib/auth';
import { generateChapterCapsuleHandler } from '@/services/learning';

export const POST = withAuth((request, auth) => generateChapterCapsuleHandler(request, auth));
