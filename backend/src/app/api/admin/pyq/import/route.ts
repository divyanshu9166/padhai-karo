import { withAuth } from '@/lib/auth';
import { importOfficialPyqHandler } from '@/services/pyq/officialImportService';

export const POST = withAuth((request, auth) => importOfficialPyqHandler(request, auth));
