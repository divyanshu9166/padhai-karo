import { withAuth } from '@/lib/auth';
import { uploadPdfDocumentHandler } from '@/services/utilities';

export const POST = withAuth((request, auth) => uploadPdfDocumentHandler(request, auth));
