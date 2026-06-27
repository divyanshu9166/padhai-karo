/**
 * Integration test: unauthenticated rejection for every `/api/allocation/*` route
 * (task 16.1; Req 10.1; design "Authentication Posture").
 *
 * Each allocation route exports a handler wrapped with {@link withAuth}, which must reject
 * any request lacking a valid session with `401 UNAUTHORIZED` *before* the wrapped service
 * handler (and therefore any Prisma read) ever runs. This test invokes each exported route
 * handler with:
 *   1. a request carrying no `Authorization` header at all, and
 *   2. a request carrying a syntactically valid bearer token that resolves to no session
 *      (an invalid/expired token).
 *
 * For both cases it asserts the response is `401` with error code `UNAUTHORIZED` and that the
 * body contains *only* the standard error envelope — no allocation payload
 * (`chapters`, `allocations`, `referenceDataYear`, `mode`, ...) and no user/session data.
 *
 * Only the session resolver is mocked so the guard can run without a live database; the pure
 * `extractBearerToken` parser keeps its real implementation, exactly as in `guard.test.ts`.
 */
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only the session resolver (shared by the guard) so unauthenticated/invalid-token
// requests are rejected without touching the database. `extractBearerToken` stays real.
vi.mock('@/lib/auth/session', async (importActual) => {
    const actual = await importActual<typeof import('@/lib/auth/session')>();
    return { ...actual, resolveSession: vi.fn() };
});

import { resolveSession } from '@/lib/auth/session';

import { GET as modeGet, PUT as modePut } from './mode/route';
import { GET as mostFrequentGet } from './most-frequent-chapters/route';
import { GET as signalGet } from './signal/route';
import { GET as suggestedGet } from './suggested-allocation/route';

const resolveSessionMock = resolveSession as Mock;

type RouteHandler = (request: Request, routeContext: unknown) => Promise<Response>;

interface AllocationRoute {
    name: string;
    method: 'GET' | 'PUT';
    handler: RouteHandler;
}

// Every protected `/api/allocation/*` route handler under test.
const ROUTES: AllocationRoute[] = [
    { name: 'GET /api/allocation/signal', method: 'GET', handler: signalGet as RouteHandler },
    {
        name: 'GET /api/allocation/most-frequent-chapters',
        method: 'GET',
        handler: mostFrequentGet as RouteHandler,
    },
    {
        name: 'GET /api/allocation/suggested-allocation',
        method: 'GET',
        handler: suggestedGet as RouteHandler,
    },
    { name: 'GET /api/allocation/mode', method: 'GET', handler: modeGet as RouteHandler },
    { name: 'PUT /api/allocation/mode', method: 'PUT', handler: modePut as RouteHandler },
];

// Allocation/user payload keys that MUST NOT appear in an unauthenticated response body.
const FORBIDDEN_PAYLOAD_KEYS = [
    'chapters',
    'allocations',
    'referenceDataYear',
    'mode',
    'shares',
    'user',
    'session',
    'userId',
];

function buildRequest(route: AllocationRoute, headerValue?: string): Request {
    const headers: Record<string, string> = {};
    if (headerValue !== undefined) {
        headers.authorization = headerValue;
    }
    const init: RequestInit = { method: route.method, headers };
    if (route.method === 'PUT') {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify({ mode: 'SUGGESTED' });
    }
    return new Request('https://api.test/api/allocation', init);
}

async function expectUnauthorized(response: Response): Promise<void> {
    expect(response.status).toBe(401);

    const body = await response.json();

    // Only the standard error envelope is present, carrying the UNAUTHORIZED code.
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(Object.keys(body)).toEqual(['error']);

    // No allocation or user/session data leaked anywhere in the payload.
    for (const key of FORBIDDEN_PAYLOAD_KEYS) {
        expect(body).not.toHaveProperty(key);
        expect(body.error).not.toHaveProperty(key);
    }
}

beforeEach(() => {
    resolveSessionMock.mockReset();
});

describe('Allocation routes reject unauthenticated requests (Req 10.1)', () => {
    describe('with no Authorization header', () => {
        for (const route of ROUTES) {
            it(`${route.name} returns 401 UNAUTHORIZED and no allocation/user data`, async () => {
                const response = await route.handler(buildRequest(route), undefined);

                await expectUnauthorized(response);
                // The guard short-circuits before ever resolving a session.
                expect(resolveSessionMock).not.toHaveBeenCalled();
            });
        }
    });

    describe('with an invalid/expired bearer token (resolves to no session)', () => {
        for (const route of ROUTES) {
            it(`${route.name} returns 401 UNAUTHORIZED and no allocation/user data`, async () => {
                resolveSessionMock.mockResolvedValue(null);

                const response = await route.handler(
                    buildRequest(route, 'Bearer invalid-or-expired-token'),
                    undefined,
                );

                await expectUnauthorized(response);
                expect(resolveSessionMock).toHaveBeenCalledWith('invalid-or-expired-token');
            });
        }
    });
});
