import { withAuth } from '@/lib/auth';
import { getPdfPageImageHandler } from '@/services/pdf';

export const GET = withAuth((request, auth, context) => getPdfPageImageHandler(request, auth, context as { params: { id: string; page: string } | Promise<{ id: string; page: string }> }));
