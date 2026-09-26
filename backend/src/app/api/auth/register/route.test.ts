import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for POST /api/auth/register.
 *
 * Covers Property 1 (registration uniqueness, Req 1.2) and the registration happy path
 * (Req 1.1, task 2.8). The handler and `createSession` both touch the database via the
 * `@/lib/db` Prisma client, so we mock that client with a deterministic in-memory user
 * store — consistent with the existing tests' mocking style — keeping the suite
 * DB-independent and reproducible.
 */

// Shared in-memory store, created via vi.hoisted so it is available inside the hoisted
// vi.mock factory below.
const store = vi.hoisted(() => ({
    users: new Map<
        string,
        { id: string; email: string; passwordHash: string; createdAt: Date; updatedAt: Date }
    >(),
}));

vi.mock('@/lib/db', () => {
    let userSeq = 0;
    let sessionSeq = 0;
    return {
        prisma: {
            user: {
                findUnique: vi.fn(async ({ where: { email } }: { where: { email: string } }) => {
                    return store.users.get(email) ?? null;
                }),
                create: vi.fn(
                    async ({
                        data: { email, passwordHash },
                    }: {
                        data: { email: string; passwordHash: string };
                    }) => {
                        if (store.users.has(email)) {
                            const err = new Error('Unique constraint failed') as Error & {
                                code: string;
                            };
                            err.code = 'P2002';
                            throw err;
                        }
                        const now = new Date();
                        const user = {
                            id: `user-${++userSeq}`,
                            email,
                            passwordHash,
                            createdAt: now,
                            updatedAt: now,
                        };
                        store.users.set(email, user);
                        return user;
                    },
                ),
            },
            session: {
                create: vi.fn(
                    async ({
                        data,
                    }: {
                        data: { userId: string; token: string; expiresAt: Date };
                    }) => {
                        const now = new Date();
                        return {
                            id: `session-${++sessionSeq}`,
                            ...data,
                            createdAt: now,
                            updatedAt: now,
                        };
                    },
                ),
            },
        },
    };
});

import { MemoryRateLimitStore, setRateLimitStore, type RateLimitStore } from '@/lib/auth';

import { POST as register } from './route';

/** Never limits, so property runs that register many accounts from one address stay valid. */
const unlimited: RateLimitStore = { peek: async () => ({ count: 0, ttlSec: 0 }), hit: async () => 1, reset: async () => undefined };

function registerRequest(email: string, password: string): Request {
    return new Request('https://api.test/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
}

const SEGMENT_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const segmentArb = fc
    .array(fc.constantFrom(...SEGMENT_CHARS), { minLength: 1, maxLength: 10 })
    .map((chars) => chars.join(''));

/** Generates syntactically valid, normalized (lowercase) email addresses. */
const emailArb: fc.Arbitrary<string> = fc
    .tuple(segmentArb, segmentArb, segmentArb)
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

const VALID_PASSWORD = 'Abcdef12';

beforeEach(() => {
    store.users.clear();
    setRateLimitStore(unlimited);
});

describe('POST /api/auth/register', () => {
    // Feature: jee-neet-study-app, Property 1: Registration is unique per email — for any
    // email, registering it once succeeds, and a second registration with the same email
    // is always rejected with a conflict error.
    it('Property 1: registering an email once succeeds and a duplicate is always rejected with a conflict error', async () => {
        await fc.assert(
            fc.asyncProperty(emailArb, async (email) => {
                store.users.clear();

                const first = await register(registerRequest(email, VALID_PASSWORD));
                expect(first.status).toBe(201);

                const second = await register(registerRequest(email, VALID_PASSWORD));
                expect(second.status).toBe(409);
                const body = await second.json();
                expect(body.error.code).toBe('EMAIL_ALREADY_EXISTS');
            }),
        );
    });

    it('happy path returns 201 with a session token and the public user, and never leaks the password hash (Req 1.1)', async () => {
        const response = await register(registerRequest('NewUser@Example.com', VALID_PASSWORD));

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(typeof body.token).toBe('string');
        expect(body.token.length).toBeGreaterThan(0);
        // Email is normalized (trimmed + lowercased) before storage.
        expect(body.user.email).toBe('newuser@example.com');
        expect(body.user).not.toHaveProperty('passwordHash');
    });

    it('returns 429 after 10 sign-up attempts from one address within an hour', async () => {
        setRateLimitStore(new MemoryRateLimitStore());
        const fromIp = (email: string) => new Request('https://api.test/api/auth/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
            body: JSON.stringify({ email, password: VALID_PASSWORD }),
        });
        for (let i = 0; i < 10; i += 1) {
            expect((await register(fromIp(`student${i}@example.in`))).status).toBe(201);
        }
        const limited = await register(fromIp('student10@example.in'));
        expect(limited.status).toBe(429);
        expect((await limited.json()).error.code).toBe('TOO_MANY_ATTEMPTS');
        // Ten argon2 hashes can take over a second under load, so the window may have ticked down.
        const retryAfter = Number(limited.headers.get('Retry-After'));
        expect(retryAfter).toBeGreaterThan(3500);
        expect(retryAfter).toBeLessThanOrEqual(3600);
    });
});
