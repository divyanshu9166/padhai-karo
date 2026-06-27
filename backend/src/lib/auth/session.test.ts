import { describe, expect, it } from 'vitest';

import {
    SESSION_TTL_MS,
    extractBearerToken,
    generateSessionToken,
    hashSessionToken,
} from './session';

describe('generateSessionToken', () => {
    it('produces a URL-safe base64url string with no padding or unsafe characters', () => {
        const token = generateSessionToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(token).not.toContain('=');
    });

    it('encodes 256 bits of entropy (32 bytes => 43 base64url chars)', () => {
        const token = generateSessionToken();
        // 32 bytes base64url-encoded is 43 characters (no padding).
        expect(token).toHaveLength(43);
    });

    it('is effectively unique across many generations', () => {
        const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
        expect(tokens.size).toBe(1000);
    });
});

describe('hashSessionToken', () => {
    it('is deterministic for the same input', () => {
        const token = generateSessionToken();
        expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    });

    it('produces a 64-char hex SHA-256 digest', () => {
        expect(hashSessionToken('any-token')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('never returns the raw token (the stored value hides the secret)', () => {
        const token = generateSessionToken();
        const hash = hashSessionToken(token);
        expect(hash).not.toBe(token);
        expect(hash).not.toContain(token);
    });

    it('maps distinct tokens to distinct hashes', () => {
        expect(hashSessionToken(generateSessionToken())).not.toBe(
            hashSessionToken(generateSessionToken()),
        );
    });
});

describe('extractBearerToken', () => {
    it('extracts the token from a well-formed Bearer header', () => {
        expect(extractBearerToken('Bearer abc.def-123')).toBe('abc.def-123');
    });

    it('treats the scheme case-insensitively', () => {
        expect(extractBearerToken('bearer xyz')).toBe('xyz');
        expect(extractBearerToken('BEARER xyz')).toBe('xyz');
    });

    it('tolerates surrounding whitespace', () => {
        expect(extractBearerToken('  Bearer   token-value  ')).toBe('token-value');
    });

    it('returns null for a missing header', () => {
        expect(extractBearerToken(null)).toBeNull();
        expect(extractBearerToken(undefined)).toBeNull();
        expect(extractBearerToken('')).toBeNull();
    });

    it('returns null for a non-Bearer scheme', () => {
        expect(extractBearerToken('Basic abc')).toBeNull();
        expect(extractBearerToken('token-without-scheme')).toBeNull();
    });

    it('returns null when the Bearer token is empty', () => {
        expect(extractBearerToken('Bearer ')).toBeNull();
        expect(extractBearerToken('Bearer    ')).toBeNull();
    });
});

describe('SESSION_TTL_MS', () => {
    it('is a positive duration (30 days)', () => {
        expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });
});
