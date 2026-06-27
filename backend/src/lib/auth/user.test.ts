import { describe, expect, it } from 'vitest';

import { toPublicUser } from './user';

describe('toPublicUser', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    it('exposes only id, email, and createdAt', () => {
        const result = toPublicUser({ id: 'u1', email: 'a@b.com', createdAt });
        expect(result).toEqual({ id: 'u1', email: 'a@b.com', createdAt });
        expect(Object.keys(result).sort()).toEqual(['createdAt', 'email', 'id']);
    });

    it('never leaks passwordHash even when present on the input row', () => {
        const fullRow = {
            id: 'u1',
            email: 'a@b.com',
            createdAt,
            passwordHash: '$argon2id$v=19$secret-hash',
            updatedAt: createdAt,
        };

        const result = toPublicUser(fullRow as never);

        expect(result).not.toHaveProperty('passwordHash');
        expect(result).not.toHaveProperty('updatedAt');
        expect(JSON.stringify(result)).not.toContain('argon2id');
    });
});
