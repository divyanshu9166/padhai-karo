/**
 * Session-validation guard and per-user isolation helpers (Req 1.7; design
 * "Authorization & Per-User Isolation", "Auth & Authorization Errors").
 *
 * This module turns the low-level session primitives ({@link extractBearerToken} +
 * {@link resolveSession} from `./session`) into an ergonomic, reusable building block for
 * Next.js App Router route handlers. It is the single mechanism every protected endpoint
 * uses to enforce the design's authentication posture:
 *
 *   - All endpoints require a valid `Authorization: Bearer <token>` session **except** the
 *     allow-listed unauthenticated ones: `POST /auth/register`, `POST /auth/login`, and the
 *     signature-verified `POST /webhooks/razorpay`. Those endpoints simply do NOT use this
 *     guard; everything else wraps its handler with {@link withAuth}.
 *   - A request lacking a valid/expired token is rejected with `401 UNAUTHORIZED` (Req 1.7)
 *     before the wrapped handler ever runs.
 *   - Once authenticated, the handler receives an {@link AuthContext} carrying the resolved
 *     `user` and `session`, so it can scope every query by `ctx.user.id` for per-user
 *     isolation.
 *   - Object-level ownership is asserted with {@link assertOwnership} before any read or
 *     mutation; a cross-user access attempt yields `403 FORBIDDEN`.
 *
 * Usage from a route file:
 * ```ts
 * import { withAuth, assertOwnership } from '@/lib/auth';
 *
 * export const GET = withAuth(async (request, ctx) => {
 *   const chapter = await prisma.chapter.findUnique({ where: { id } });
 *   assertOwnership(chapter?.userId, ctx.user.id); // 403 if not the owner
 *   return Response.json({ chapter });
 * });
 * ```
 *
 * Dynamic-route params are preserved: the framework's second handler argument (e.g.
 * `{ params: { id } }`) is forwarded to the wrapped handler as its third argument.
 */
import type { Session, User } from '@prisma/client';

import { ErrorCode, errorResponse } from '@/lib/errors';

import { extractBearerToken, resolveSession } from './session';

/**
 * The authenticated principal handed to a guarded handler. Carries the resolved owning
 * {@link User} (use `user.id` to scope queries) and the live {@link Session}.
 */
export interface AuthContext {
    user: User;
    session: Session;
}

/**
 * A route handler that runs only after authentication has succeeded.
 *
 * @typeParam RouteContext - the framework-provided route context (e.g.
 *   `{ params: { id: string } }` for dynamic segments). Defaults to `unknown`.
 *
 * @param request - the incoming request.
 * @param auth - the authenticated {@link AuthContext}.
 * @param routeContext - the framework's second argument, forwarded unchanged.
 */
export type AuthenticatedRouteHandler<RouteContext = unknown> = (
    request: Request,
    auth: AuthContext,
    routeContext: RouteContext,
) => Response | Promise<Response>;

/**
 * Thrown by {@link assertOwnership} when a caller attempts to access a resource it does
 * not own. {@link withAuth} catches this and maps it to a `403 FORBIDDEN` response, so
 * handlers can assert ownership inline without manually returning an error response.
 */
export class ForbiddenError extends Error {
    constructor(message = 'You do not have access to this resource.') {
        super(message);
        this.name = 'ForbiddenError';
    }
}

/** Build the standard `401 UNAUTHORIZED` envelope used for missing/invalid sessions. */
export function unauthorizedResponse(message = 'Authentication is required.'): Response {
    return errorResponse(401, ErrorCode.UNAUTHORIZED, message);
}

/** Build the standard `403 FORBIDDEN` envelope used for cross-user access attempts. */
export function forbiddenResponse(
    message = 'You do not have access to this resource.',
): Response {
    return errorResponse(403, ErrorCode.FORBIDDEN, message);
}

/**
 * Wrap a route handler so it only runs for requests bearing a valid session token.
 *
 * The returned function matches the Next.js App Router handler signature
 * `(request, routeContext) => Promise<Response>` and can be exported directly as `GET`,
 * `POST`, etc.
 *
 * Flow:
 *   1. Extract the bearer token from the `Authorization` header. Missing/malformed →
 *      `401 UNAUTHORIZED` (Req 1.7).
 *   2. Resolve the token via {@link resolveSession}. Unknown/expired → `401 UNAUTHORIZED`.
 *   3. Invoke the wrapped handler with the {@link AuthContext} and the forwarded route
 *      context. A {@link ForbiddenError} thrown by the handler (typically via
 *      {@link assertOwnership}) is mapped to `403 FORBIDDEN`; any other error propagates.
 */
export function withAuth<RouteContext = unknown>(
    handler: AuthenticatedRouteHandler<RouteContext>,
): (request: Request, routeContext: RouteContext) => Promise<Response> {
    return async (request: Request, routeContext: RouteContext): Promise<Response> => {
        const rawToken = extractBearerToken(request.headers.get('authorization'));
        if (!rawToken) {
            return unauthorizedResponse();
        }

        const resolved = await resolveSession(rawToken);
        if (!resolved) {
            return unauthorizedResponse('Invalid or expired session.');
        }

        const auth: AuthContext = { user: resolved.user, session: resolved.session };

        try {
            return await handler(request, auth, routeContext);
        } catch (error) {
            if (error instanceof ForbiddenError) {
                return forbiddenResponse(error.message);
            }
            throw error;
        }
    };
}

/**
 * Pure ownership predicate: does `resourceUserId` belong to the authenticated user?
 *
 * Returns `false` for a nullish `resourceUserId` (e.g. a missing record), so callers can
 * treat "not found" and "not owned" uniformly as a non-ownership case without leaking
 * resource existence across users.
 */
export function ownsResource(
    resourceUserId: string | null | undefined,
    authUserId: string,
): boolean {
    return resourceUserId != null && resourceUserId === authUserId;
}

/**
 * Assert that the authenticated user owns the requested resource, throwing
 * {@link ForbiddenError} otherwise. Call this before any read or mutation of a user-owned
 * record. When used inside a {@link withAuth} handler, the thrown error becomes a
 * `403 FORBIDDEN` response automatically.
 *
 * @param resourceUserId - the `userId` stamped on the resource (or nullish if absent).
 * @param authUserId - the authenticated user's id (`ctx.user.id`).
 * @param message - optional override for the error message.
 */
export function assertOwnership(
    resourceUserId: string | null | undefined,
    authUserId: string,
    message?: string,
): void {
    if (!ownsResource(resourceUserId, authUserId)) {
        throw new ForbiddenError(message);
    }
}
