/**
 * POST /api/auth/logout — invalidate the current session (Req 1; design "Session Token
 * Handling").
 *
 * The caller presents its session token as `Authorization: Bearer <token>`. The matching
 * session is revoked (its stored hash is deleted) so the token can never be used again.
 *
 * Outcomes:
 *   - `204` on success (no body).
 *   - `401 UNAUTHORIZED` when no bearer token is present, since logout acts on the
 *     current session and there is nothing to act on without one.
 *
 * Revocation is idempotent: presenting a token whose session is already gone (e.g. a
 * repeated logout) still returns `204`.
 */
import { extractBearerToken, revokeSession } from '@/lib/auth';
import { ErrorCode, errorResponse } from '@/lib/errors';

export async function POST(request: Request): Promise<Response> {
    const rawToken = extractBearerToken(request.headers.get('authorization'));
    if (!rawToken) {
        return errorResponse(401, ErrorCode.UNAUTHORIZED, 'Authentication is required.');
    }

    await revokeSession(rawToken);
    return new Response(null, { status: 204 });
}
