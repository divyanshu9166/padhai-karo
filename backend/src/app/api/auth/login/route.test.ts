import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for POST /api/auth/login.
 *
 * Covers Property 3 (credential authentication round-trip, Req 1.4/1.5) exercised
 * end-to-end through the real login route handler. The handler reads the account via
 * the `@/lib/db` Prisma client and `createSession` persists a session row, so we mock
 * that client with a deterministic in-memory store — matching the existing
 * register-route test's style — while using the REAL `hashPassword`/`verifyPassword`
 * so the credential round-trip is genuine rather than stubbed.
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
    let sessionSeq = 0;
    return {
        prisma: {
            user: {
                findUnique: vi.fn(async ({ where: { email } }: { where: { email: string } }) => {
                    return store.users.get(email) ?? null;
                }),
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

import { hashPassword } from '@/lib/auth';

import { POST as login } from './route';

function loginRequest(email: string, password: string): Request {
    return new Request('https://api.test/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
}

/** Seed the in-memory store with one account whose passwordHash is a real argon2id hash. */
async function seedUser(email: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const now = new Date();
    store.users.set(email, {
        id: `user-${email}`,
        email,
        passwordHash,
        createdAt: now,
        updatedAt: now,
    });
}

const LOWERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const UPPERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '0123456789'.split('');

/** Passwords guaranteed to satisfy the registration policy (mixed case + digit, len >= 8). */
const validPasswordArb: fc.Arbitrary<string> = fc
    .tuple(
        fc.constantFrom(...LOWERS),
        fc.constantFrom(...UPPERS),
        fc.constantFrom(...DIGITS),
        fc.array(fc.constantFrom(...LOWERS, ...UPPERS, ...DIGITS), {
            minLength: 5,
            maxLength: 20,
        }),
    )
    .map(([lower, upper, digit, rest]) => [lower, upper, digit, ...rest].join(''));

beforeEach(() => {
    store.users.clear();
});

describe('POST /api/auth/login', () => {
    // Feature: jee-neet-study-app, Property 3: Credential authentication round-trip — for
    // any account created with a valid password, signing in with the exact credentials
    // returns a session token, and signing in with any differing password is rejected with
    // an authentication error. Exercised through the real login handler with a mocked
    // Prisma store and the real hash/verify so the round-trip is genuine.
    it('Property 3: exact credentials return a token while any differing password is rejected with 401', async () => {
        await fc.assert(
            fc.asyncProperty(
                validPasswordArb,
                validPasswordArb,
                async (password, otherPassword) => {
                    fc.pre(password !== otherPassword);
                    store.users.clear();

                    const email = 'aspirant@example.com';
                    await seedUser(email, password);

                    const ok = await login(loginRequest(email, password));
                    expect(ok.status).toBe(200);
                    const okBody = await ok.json();
                    expect(typeof okBody.token).toBe('string');
                    expect(okBody.token.length).toBeGreaterThan(0);
                    expect(okBody.user.email).toBe(email);
                    expect(okBody.user).not.toHaveProperty('passwordHash');

                    const bad = await login(loginRequest(email, otherPassword));
                    expect(bad.status).toBe(401);
                    const badBody = await bad.json();
                    expect(badBody.error.code).toBe('AUTHENTICATION_FAILED');
                },
            ),
            // hashPassword is memory-hard; each run hashes once at seed plus two verifies,
            // so this is the most expensive property in the suite. Cap it low to keep the
            // run fast (the round-trip still holds across a meaningful spread of inputs).
            { numRuns: 8 },
        );
    });

    it('happy path: correct credentials return a session token and the public user (Req 1.4)', async () => {
        await seedUser('learner@example.com', 'Abcdef12');

        const response = await login(loginRequest('learner@example.com', 'Abcdef12'));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(typeof body.token).toBe('string');
        expect(body.token.length).toBeGreaterThan(0);
        expect(body.user.email).toBe('learner@example.com');
        expect(body.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password for an existing account with 401 (Req 1.5)', async () => {
        await seedUser('learner@example.com', 'Abcdef12');

        const response = await login(loginRequest('learner@example.com', 'Wrongpass9'));

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error.code).toBe('AUTHENTICATION_FAILED');
    });

    it('rejects an unknown email generically with 401 without revealing account existence (Req 1.5)', async () => {
        const response = await login(loginRequest('nobody@example.com', 'Abcdef12'));

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error.code).toBe('AUTHENTICATION_FAILED');
    });
});
