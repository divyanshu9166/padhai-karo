/**
 * POST /api/auth/password-reset/confirm — set a new password with an emailed code.
 * Unauthenticated. See {@link confirmPasswordResetHandler} for the response contract.
 */
import { confirmPasswordResetHandler } from '@/services/account';

export const dynamic = 'force-dynamic';

export const POST = (request: Request): Promise<Response> => confirmPasswordResetHandler(request);
