import { describe, expect, it } from 'vitest';

import {
    ARGON2_PARAMS,
    PASSWORD_POLICY,
    PasswordRequirement,
    hashPassword,
    validatePassword,
    verifyPassword,
} from './password';

describe('validatePassword', () => {
    it('accepts a password that meets every requirement', () => {
        const result = validatePassword('Abcdef12');
        expect(result.valid).toBe(true);
    });

    it('accepts a long, mixed password up to the maximum length', () => {
        const password = `Aa1${'x'.repeat(PASSWORD_POLICY.maxLength - 3)}`;
        expect(password.length).toBe(PASSWORD_POLICY.maxLength);
        expect(validatePassword(password).valid).toBe(true);
    });

    it('rejects a too-short password and identifies MIN_LENGTH', () => {
        const result = validatePassword('Ab1');
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.requirement).toBe(PasswordRequirement.MIN_LENGTH);
            expect(result.unmet).toContain(PasswordRequirement.MIN_LENGTH);
            expect(result.message).toMatch(/at least 8/);
        }
    });

    it('rejects a too-long password and identifies MAX_LENGTH', () => {
        // Valid mix so MAX_LENGTH is the only failed requirement.
        const password = `Aa1${'x'.repeat(PASSWORD_POLICY.maxLength)}`;
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.requirement).toBe(PasswordRequirement.MAX_LENGTH);
            expect(result.unmet).toEqual([PasswordRequirement.MAX_LENGTH]);
        }
    });

    it('rejects a password with no lowercase letter and identifies LOWERCASE', () => {
        const result = validatePassword('ABCDEFG1');
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.requirement).toBe(PasswordRequirement.LOWERCASE);
        }
    });

    it('rejects a password with no uppercase letter and identifies UPPERCASE', () => {
        const result = validatePassword('abcdefg1');
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.requirement).toBe(PasswordRequirement.UPPERCASE);
        }
    });

    it('rejects a password with no digit and identifies DIGIT', () => {
        const result = validatePassword('Abcdefgh');
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.requirement).toBe(PasswordRequirement.DIGIT);
        }
    });

    it('collects all unmet requirements in evaluation order', () => {
        // "aaa": too short, no uppercase, no digit (has lowercase).
        const result = validatePassword('aaa');
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.unmet).toEqual([
                PasswordRequirement.MIN_LENGTH,
                PasswordRequirement.UPPERCASE,
                PasswordRequirement.DIGIT,
            ]);
            // The primary requirement is the first failure.
            expect(result.requirement).toBe(PasswordRequirement.MIN_LENGTH);
        }
    });
});

describe('hashPassword / verifyPassword', () => {
    it('produces an argon2id hash that is not the plaintext', async () => {
        const password = 'Abcdef12';
        const hash = await hashPassword(password);
        expect(hash).not.toContain(password);
        expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    it('uses a unique salt so the same password hashes differently each time', async () => {
        const password = 'Abcdef12';
        const a = await hashPassword(password);
        const b = await hashPassword(password);
        expect(a).not.toBe(b);
    });

    it('verify returns true for the correct password', async () => {
        const password = 'Abcdef12';
        const hash = await hashPassword(password);
        await expect(verifyPassword(password, hash)).resolves.toBe(true);
    });

    it('verify returns false for an incorrect password', async () => {
        const hash = await hashPassword('Abcdef12');
        await expect(verifyPassword('Abcdef13', hash)).resolves.toBe(false);
    });

    it('verify returns false for an empty or malformed stored hash', async () => {
        await expect(verifyPassword('Abcdef12', '')).resolves.toBe(false);
        await expect(verifyPassword('Abcdef12', 'not-a-real-hash')).resolves.toBe(false);
    });

    it('embeds the configured argon2id parameters in the encoded hash', async () => {
        const hash = await hashPassword('Abcdef12');
        expect(hash).toContain(`m=${ARGON2_PARAMS.memorySize}`);
        expect(hash).toContain(`t=${ARGON2_PARAMS.iterations}`);
        expect(hash).toContain(`p=${ARGON2_PARAMS.parallelism}`);
    });
});
