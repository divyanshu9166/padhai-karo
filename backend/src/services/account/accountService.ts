import { verifyPassword } from '@/lib/auth';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

const DELETE_CONFIRMATION = 'DELETE_MY_ACCOUNT';

export interface AccountDeletionPrisma {
    user: {
        delete(args: { where: { id: string } }): Promise<unknown>;
    };
}

function isDeleteRequest(body: unknown): body is { confirmation: string; password: string } {
    return typeof body === 'object' && body !== null &&
        typeof (body as { confirmation?: unknown }).confirmation === 'string' &&
        typeof (body as { password?: unknown }).password === 'string';
}

/**
 * Permanently delete the signed-in account after an explicit phrase and password check.
 * Every user-owned relation in the Prisma schema uses `onDelete: Cascade`, so the database
 * removes associated server records atomically with the user row.
 */
export async function deleteAccountHandler(
    request: Request,
    auth: Pick<AuthContext, 'user'>,
    deps: { prisma: AccountDeletionPrisma; verifyPassword: typeof verifyPassword } = { prisma, verifyPassword },
): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A deletion confirmation and password are required.');
    }

    if (!isDeleteRequest(body) || body.confirmation !== DELETE_CONFIRMATION) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, `Type ${DELETE_CONFIRMATION} to confirm account deletion.`);
    }
    if (!body.password || !(await deps.verifyPassword(body.password, auth.user.passwordHash))) {
        return errorResponse(403, ErrorCode.FORBIDDEN, 'Your password could not be verified.');
    }

    await deps.prisma.user.delete({ where: { id: auth.user.id } });
    return new Response(null, { status: 204 });
}

export { DELETE_CONFIRMATION };
