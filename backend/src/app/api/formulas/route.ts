import { withAuth } from '@/lib/auth';
import { createFormulaItemHandler, listFormulaItemsHandler } from '@/services/learning';

export const GET = withAuth((request, auth) => listFormulaItemsHandler(request, auth));
export const POST = withAuth((request, auth) => createFormulaItemHandler(request, auth));
