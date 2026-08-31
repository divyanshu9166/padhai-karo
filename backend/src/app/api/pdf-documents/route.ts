import { withAuth } from '@/lib/auth';
import { createPdfDocumentHandler, listPdfDocumentsHandler } from '@/services/utilities';

export const GET = withAuth((request, auth) => listPdfDocumentsHandler(request, auth));
export const POST = withAuth((request, auth) => createPdfDocumentHandler(request, auth));
