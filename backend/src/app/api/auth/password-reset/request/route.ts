/**
 * POST /api/auth/password-reset/request — email a 6-digit reset code. Unauthenticated.
 * See {@link requestPasswordResetHandler} for the response contract.
 */
import { requestPasswordResetHandler } from '@/services/account';

export const dynamic = 'force-dynamic';

export const POST = (request: Request): Promise<Response> => requestPasswordResetHandler(request);
