import { describe, expect, it } from 'vitest';

import { isValidEmail, normalizeEmail } from './email';

describe('normalizeEmail', () => {
    it('trims surrounding whitespace and lowercases', () => {
        expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
    });

    it('leaves an already-canonical email unchanged', () => {
        expect(normalizeEmail('user@example.com')).toBe('user@example.com');
    });
});

describe('isValidEmail', () => {
    it('accepts well-formed addresses', () => {
        expect(isValidEmail('user@example.com')).toBe(true);
        expect(isValidEmail('a.b+tag@sub.domain.co')).toBe(true);
    });

    it('rejects addresses without a domain dot', () => {
        expect(isValidEmail('user@localhost')).toBe(false);
    });

    it('rejects addresses missing local part, @, or domain', () => {
        expect(isValidEmail('@example.com')).toBe(false);
        expect(isValidEmail('userexample.com')).toBe(false);
        expect(isValidEmail('user@')).toBe(false);
    });

    it('rejects addresses containing whitespace', () => {
        expect(isValidEmail('user @example.com')).toBe(false);
        expect(isValidEmail('user@exa mple.com')).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(isValidEmail('')).toBe(false);
    });
});
