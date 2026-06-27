import type { Session, User } from '@prisma/client';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only the session resolver so the guard can be exercised without a live database.
// `extractBearerToken` (a pure parser) keeps its real implementation.
vi.mock('./session', async (importActual) => {
    const actual = await importActual<typeof import('./session')>();
    return { ...actual, resolveSession: vi.fn() };
});

import {
    ForbiddenError,
    assertOwnership,
    type AuthContext,
    ownsResource,
    withAuth,
} from './guard';
import { resolveSession } from './session';

const resolveSessionMock = resolveSession as Mock;

const fakeUser: User = {
    id: 'user-1',
    email: 'a@example.com',
    passwordHash: 'hash',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
} as User;

const fakeSession: Session = {
    id: 'session-1',
    userId: 'user-1',
    token: 'token-hash',
    expiresAt: new Date('2999-01-01T00:00:00.000Z'),
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
} as Session;

function requestWithAuth(headerValue?: string): Request {
    const headers: Record<string, string> = {};
    if (headerValue !== undefined) {
        headers.authorization = headerValue;
    }
    return new Request('https://api.test/protected', { headers });
}

beforeEach(() => {
    resolveSessionMock.mockReset();
});

describe('withAuth', () => {
    it('rejects a request with no Authorization header with 401 and never calls the handler', async () => {
        const handler = vi.fn();
        const route = withAuth(handler);

        const response = await route(requestWithAuth(), undefined);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(handler).not.toHaveBeenCalled();
        expect(resolveSessionMock).not.toHaveBeenCalled();
    });

    it('rejects a malformed Authorization header with 401', async () => {
        const handler = vi.fn();
        const route = withAuth(handler);

        const response = await route(requestWithAuth('Basic abc'), undefined);

        expect(response.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
        expect(resolveSessionMock).not.toHaveBeenCalled();
    });

    it('rejects an unknown/expired token (resolveSession -> null) with 401', async () => {
        resolveSessionMock.mockResolvedValue(null);
        const handler = vi.fn();
        const route = withAuth(handler);

        const response = await route(requestWithAuth('Bearer expired-token'), undefined);

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(resolveSessionMock).toHaveBeenCalledWith('expired-token');
        expect(handler).not.toHaveBeenCalled();
    });

    it('invokes the handler with the authenticated user/session context on a valid token', async () => {
        resolveSessionMock.mockResolvedValue({ user: fakeUser, session: fakeSession });
        const handler = vi.fn(
            (_req: Request, ctx: AuthContext) =>
                Response.json({ id: ctx.user.id, session: ctx.session.id }, { status: 200 }),
        );
        const route = withAuth(handler);
        const request = requestWithAuth('Bearer good-token');

        const response = await route(request, undefined);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ id: 'user-1', session: 'session-1' });
        expect(handler).toHaveBeenCalledTimes(1);
        const [passedRequest, passedCtx] = handler.mock.calls[0];
        expect(passedRequest).toBe(request);
        expect(passedCtx).toEqual({ user: fakeUser, session: fakeSession });
    });

    it('forwards the framework route context (e.g. dynamic params) to the handler', async () => {
        resolveSessionMock.mockResolvedValue({ user: fakeUser, session: fakeSession });
        type RouteContext = { params: { id: string } };
        const handler = vi.fn(
            (_req: Request, _ctx: AuthContext, _routeContext: RouteContext) =>
                new Response(null, { status: 204 }),
        );
        const route = withAuth<RouteContext>(handler);
        const routeContext: RouteContext = { params: { id: 'chapter-42' } };

        await route(requestWithAuth('Bearer good-token'), routeContext);

        expect(handler.mock.calls[0][2]).toBe(routeContext);
    });

    it('maps a ForbiddenError thrown by the handler to 403 FORBIDDEN', async () => {
        resolveSessionMock.mockResolvedValue({ user: fakeUser, session: fakeSession });
        const route = withAuth(() => {
            throw new ForbiddenError();
        });

        const response = await route(requestWithAuth('Bearer good-token'), undefined);

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.error.code).toBe('FORBIDDEN');
    });

    it('propagates non-Forbidden errors thrown by the handler', async () => {
        resolveSessionMock.mockResolvedValue({ user: fakeUser, session: fakeSession });
        const route = withAuth(() => {
            throw new Error('boom');
        });

        await expect(route(requestWithAuth('Bearer good-token'), undefined)).rejects.toThrow(
            'boom',
        );
    });
});

describe('ownsResource', () => {
    it('is true only when the resource userId matches the authenticated user', () => {
        expect(ownsResource('user-1', 'user-1')).toBe(true);
        expect(ownsResource('user-2', 'user-1')).toBe(false);
    });

    it('is false for a nullish resource owner', () => {
        expect(ownsResource(null, 'user-1')).toBe(false);
        expect(ownsResource(undefined, 'user-1')).toBe(false);
    });
});

describe('assertOwnership', () => {
    it('passes silently when the user owns the resource', () => {
        expect(() => assertOwnership('user-1', 'user-1')).not.toThrow();
    });

    it('throws ForbiddenError on a cross-user access attempt', () => {
        expect(() => assertOwnership('user-2', 'user-1')).toThrow(ForbiddenError);
    });

    it('throws ForbiddenError when the resource owner is nullish (missing record)', () => {
        expect(() => assertOwnership(null, 'user-1')).toThrow(ForbiddenError);
    });

    it('within a withAuth handler, yields 403 on mismatch and 200 on match', async () => {
        resolveSessionMock.mockResolvedValue({ user: fakeUser, session: fakeSession });

        const route = withAuth((_req, ctx) => {
            // Simulate loading a resource owned by a different user.
            assertOwnership('someone-else', ctx.user.id);
            return new Response(null, { status: 200 });
        });
        const forbidden = await route(requestWithAuth('Bearer good-token'), undefined);
        expect(forbidden.status).toBe(403);

        const okRoute = withAuth((_req, ctx) => {
            assertOwnership(ctx.user.id, ctx.user.id);
            return new Response(null, { status: 200 });
        });
        const ok = await okRoute(requestWithAuth('Bearer good-token'), undefined);
        expect(ok.status).toBe(200);
    });
});
