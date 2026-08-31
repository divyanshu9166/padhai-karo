import { withAuth } from '@/lib/auth';
import { getPdfFileByChecksumHandler } from '@/services/utilities';

export const GET = withAuth((request, auth) => getPdfFileByChecksumHandler(request, auth));
