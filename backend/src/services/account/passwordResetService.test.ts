import { beforeEach, describe, expect, it, vi } from 'vitest';

type TokenRow = { id: string; userId: string; codeHash: string; expiresAt: Date; attempts: number; consumedAt: Date | null; createdAt: Date };

const db = vi.hoisted(() => ({
    users: new Map<string, { id: string; email: string; passwordHash: string; createdAt: Date; updatedAt: Date }>(),
    tokens: [] as TokenRow[],
    sessions: [] as { userId: string; token: string }[],
    sentCodes: [] as { to: string; code: string }[],
}));

vi.mock('@/lib/mail', () => ({
    emailDeliveryConfigured: () => true,
    sendEmail: vi.fn(async ({ to, text }: { to: string; text: string }) => {
        db.sentCodes.push({ to, code: /code is (\d{6})/.exec(text)![1]! });
        return true;
    }),
}));

vi.mock('@/lib/db', () => {
    let seq = 0;
    const matches = (row: TokenRow, where: Record<string, unknown>) =>
        (where.id === undefined || row.id === where.id) &&
        (where.userId === undefined || row.userId === where.userId) &&
        (!('consumedAt' in where) || row.consumedAt === where.consumedAt) &&
        (where.expiresAt === undefined || row.expiresAt > (where.expiresAt as { gt: Date }).gt);
    const passwordResetToken = {
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<TokenRow> }) => {
            const rows = db.tokens.filter((row) => matches(row, where));
            rows.forEach((row) => Object.assign(row, data));
            return { count: rows.length };
        }),
        create: vi.fn(async ({ data }: { data: Pick<TokenRow, 'userId' | 'codeHash' | 'expiresAt'> }) => {
            const row: TokenRow = { id: `t${++seq}`, attempts: 0, consumedAt: null, createdAt: new Date(Date.now() + seq), ...data };
            db.tokens.push(row);
            return row;
        }),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
            db.tokens.filter((row) => matches(row, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<TokenRow> }) => Object.assign(db.tokens.find((row) => row.id === where.id)!, data)),
    };
    const prisma = {
        user: {
            findUnique: vi.fn(async ({ where }: { where: { email: string } }) => db.users.get(where.email) ?? null),
            update: vi.fn(async ({ where, data }: { where: { id: string }; data: { passwordHash: string } }) => {
                const user = [...db.users.values()].find((u) => u.id === where.id)!;
                user.passwordHash = data.passwordHash;
                return user;
            }),
        },
        passwordResetToken,
        session: {
            create: vi.fn(async ({ data }: { data: { userId: string; token: string } }) => {
                db.sessions.push(data);
                return { id: `s${++seq}`, ...data };
            }),
            deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
                const before = db.sessions.length;
                db.sessions = db.sessions.filter((s) => s.userId !== where.userId);
                return { count: before - db.sessions.length };
            }),
        },
        $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]))),
    };
    return { prisma, default: prisma };
});

import { MemoryRateLimitStore, hashPassword, setRateLimitStore, verifyPassword } from '@/lib/auth';

import { confirmPasswordResetHandler, generateResetCode, requestPasswordResetHandler } from './passwordResetService';

function post(body: unknown, ip = '198.51.100.4'): Request {
    return new Request('https://api.test/api/auth/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify(body),
    });
}

const EMAIL = 'aspirant@example.in';
const NEW_PASSWORD = 'NewPass123';

beforeEach(async () => {
    db.users.clear();
    db.tokens.length = 0;
    db.sessions = [{ userId: 'u1', token: 'old-session' }];
    db.sentCodes.length = 0;
    setRateLimitStore(new MemoryRateLimitStore());
    const now = new Date();
    db.users.set(EMAIL, { id: 'u1', email: EMAIL, passwordHash: await hashPassword('OldPass123'), createdAt: now, updatedAt: now });
});

async function requestCode(email = EMAIL): Promise<string | undefined> {
    const response = await requestPasswordResetHandler(post({ email }));
    expect(response.status).toBe(200);
    return db.sentCodes.at(-1)?.code;
}

describe('password reset', () => {
    it('generates 6-digit codes', () => {
        for (let i = 0; i < 50; i += 1) expect(generateResetCode()).toMatch(/^\d{6}$/);
    });

    it('emails a code, changes the password, revokes old sessions, and signs the student in', async () => {
        const code = await requestCode();
        expect(code).toMatch(/^\d{6}$/);
        expect(db.tokens[0]!.codeHash).not.toContain(code!);

        const response = await confirmPasswordResetHandler(post({ email: EMAIL, code, newPassword: NEW_PASSWORD }));
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(typeof body.token).toBe('string');
        expect(body.user).not.toHaveProperty('passwordHash');
        expect(await verifyPassword(NEW_PASSWORD, db.users.get(EMAIL)!.passwordHash)).toBe(true);
        expect(db.sessions.some((s) => s.token === 'old-session')).toBe(false);
        expect(db.tokens[0]!.consumedAt).not.toBeNull();
    });

    it('returns the same response for an unknown email and sends nothing', async () => {
        const response = await requestPasswordResetHandler(post({ email: 'unknown@example.in' }));
        const known = await requestPasswordResetHandler(post({ email: EMAIL }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(await known.json());
        expect(db.sentCodes.filter((s) => s.to === 'unknown@example.in')).toHaveLength(0);
    });

    it('rejects a code that was already used', async () => {
        const code = await requestCode();
        expect((await confirmPasswordResetHandler(post({ email: EMAIL, code, newPassword: NEW_PASSWORD }))).status).toBe(200);
        const replay = await confirmPasswordResetHandler(post({ email: EMAIL, code, newPassword: 'Another123' }));
        expect(replay.status).toBe(400);
        expect((await replay.json()).error.code).toBe('INVALID_RESET_CODE');
    });

    it('kills the code after 5 wrong guesses so it cannot be brute-forced', async () => {
        const code = await requestCode();
        const wrong = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i += 1) {
            expect((await confirmPasswordResetHandler(post({ email: EMAIL, code: wrong, newPassword: NEW_PASSWORD }))).status).toBe(400);
        }
        const correctButDead = await confirmPasswordResetHandler(post({ email: EMAIL, code, newPassword: NEW_PASSWORD }));
        expect(correctButDead.status).toBe(400);
        expect(await verifyPassword('OldPass123', db.users.get(EMAIL)!.passwordHash)).toBe(true);
    });

    it('rejects an expired code', async () => {
        const code = await requestCode();
        db.tokens[0]!.expiresAt = new Date(Date.now() - 1000);
        expect((await confirmPasswordResetHandler(post({ email: EMAIL, code, newPassword: NEW_PASSWORD }))).status).toBe(400);
    });

    it('invalidates an older code when a new one is requested', async () => {
        const first = await requestCode();
        const second = await requestCode();
        if (first !== second) {
            expect((await confirmPasswordResetHandler(post({ email: EMAIL, code: first, newPassword: NEW_PASSWORD }))).status).toBe(400);
        }
        expect((await confirmPasswordResetHandler(post({ email: EMAIL, code: second, newPassword: NEW_PASSWORD }))).status).toBe(200);
    });

    it('enforces the password policy on the new password', async () => {
        const code = await requestCode();
        const response = await confirmPasswordResetHandler(post({ email: EMAIL, code, newPassword: 'weak' }));
        expect(response.status).toBe(422);
        expect((await response.json()).error.code).toBe('WEAK_PASSWORD');
        expect(db.tokens[0]!.consumedAt).toBeNull();
    });

    it('limits reset emails to 3 per hour for one email', async () => {
        for (let i = 0; i < 3; i += 1) await requestCode();
        const limited = await requestPasswordResetHandler(post({ email: EMAIL }));
        expect(limited.status).toBe(429);
        expect(db.sentCodes).toHaveLength(3);
    });

    it('rejects a malformed email with 422', async () => {
        expect((await requestPasswordResetHandler(post({ email: 'not-an-email' }))).status).toBe(422);
    });
});
