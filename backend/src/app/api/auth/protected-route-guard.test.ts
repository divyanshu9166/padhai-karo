import { describe, expect, it, vi } from 'vitest';

/**
 * Integration test for the protected-route guard (Req 1.7, task 2.8).
 *
 * Exercises representative protected endpoints end-to-end through their real exported
 * route handlers (each wrapped with `withAuth`) and asserts that a request lacking a
 * valid `Authorization: Bearer` token is rejected with `401 UNAUTHORIZED` before any
 * handler logic runs. The Prisma client is mocked so the test is DB-independent; the
 * guard rejects unauthenticated requests before the database is ever touched.
 */

vi.mock('@/lib/db', () => ({ prisma: {}, default: {} }));

import { GET as chaptersGet } from '../chapters/route';
import { GET as dashboardGet } from '../dashboard/route';
import { POST as focusPost } from '../focus-sessions/route';
import { POST as mistakesPost } from '../mistakes/route';
import { GET as meGet } from './me/route';

type RouteHandler = (request: Request, routeContext: unknown) => Promise<Response>;

const protectedEndpoints: Array<[string, RouteHandler]> = [
    ['GET /auth/me', meGet as RouteHandler],
    ['GET /dashboard', dashboardGet as RouteHandler],
    ['GET /chapters', chaptersGet as RouteHandler],
    ['POST /focus-sessions', focusPost as RouteHandler],
    ['POST /mistakes', mistakesPost as RouteHandler],
];

describe('protected-route guard rejects unauthenticated requests (Req 1.7)', () => {
    it.each(protectedEndpoints)(
        '%s without an Authorization header returns 401 UNAUTHORIZED',
        async (_name, handler) => {
            const response = await handler(new Request('https://api.test/protected'), undefined);

            expect(response.status).toBe(401);
            const body = await response.json();
            expect(body.error.code).toBe('UNAUTHORIZED');
        },
    );

    it.each(protectedEndpoints)(
        '%s with a non-Bearer Authorization header returns 401 UNAUTHORIZED',
        async (_name, handler) => {
            const response = await handler(
                new Request('https://api.test/protected', {
                    headers: { authorization: 'Basic dXNlcjpwYXNz' },
                }),
                undefined,
            );

            expect(response.status).toBe(401);
            const body = await response.json();
            expect(body.error.code).toBe('UNAUTHORIZED');
        },
    );
});
