import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ConfigError, loadConfig, type EnvSource } from './config';

/**
 * Unit + property tests for the server-side config loader (task 1.2).
 *
 * These exercise `loadConfig` against an in-memory env bag only — no `process.env`
 * mutation and no live Postgres/Redis — so the suite runs without external services.
 */

const VALID_ENV: EnvSource = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
    REDIS_URL: 'redis://localhost:6379',
    AI_PROVIDER_API_KEY: 'ai-key-123',
    RAZORPAY_KEY_ID: 'rzp_test_id',
    RAZORPAY_KEY_SECRET: 'rzp_test_secret',
    RAZORPAY_WEBHOOK_SECRET: 'rzp_webhook_secret',
};

const REQUIRED_KEYS = [
    'DATABASE_URL',
    'REDIS_URL',
    'AI_PROVIDER_API_KEY',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
] as const;

describe('loadConfig', () => {
    it('reads and maps every value when all required vars are present', () => {
        const config = loadConfig(VALID_ENV);

        expect(config).toEqual({
            databaseUrl: 'postgresql://user:pass@localhost:5432/app',
            redisUrl: 'redis://localhost:6379',
            ai: { apiKey: 'ai-key-123' },
            razorpay: {
                keyId: 'rzp_test_id',
                keySecret: 'rzp_test_secret',
                webhookSecret: 'rzp_webhook_secret',
            },
        });
    });

    it('throws ConfigError when a required var is missing', () => {
        const { DATABASE_URL: _omit, ...withoutDb } = VALID_ENV;

        expect(() => loadConfig(withoutDb)).toThrow(ConfigError);
        expect(() => loadConfig(withoutDb)).toThrow(/DATABASE_URL/);
    });

    it('treats a whitespace-only value as missing', () => {
        expect(() => loadConfig({ ...VALID_ENV, REDIS_URL: '   ' })).toThrow(ConfigError);
    });

    it('reports every missing var, not just the first', () => {
        try {
            loadConfig({});
            expect.unreachable('expected ConfigError');
        } catch (err) {
            expect(err).toBeInstanceOf(ConfigError);
            expect((err as ConfigError).missing).toEqual([...REQUIRED_KEYS]);
        }
    });

    it('does not leak secret values into the error message', () => {
        // Only var names should appear in the thrown message, never values.
        const err = (() => {
            try {
                loadConfig({});
            } catch (e) {
                return e as ConfigError;
            }
            return undefined;
        })();
        expect(err).toBeDefined();
        expect(err!.message).not.toContain('rzp_test_secret');
    });

    // Property: omitting any single required var always fails validation and names it.
    it('fails for every single-variable omission', () => {
        fc.assert(
            fc.property(fc.constantFrom(...REQUIRED_KEYS), (keyToDrop) => {
                const env: EnvSource = { ...VALID_ENV };
                delete env[keyToDrop];

                let thrown: ConfigError | undefined;
                try {
                    loadConfig(env);
                } catch (e) {
                    thrown = e as ConfigError;
                }
                return thrown instanceof ConfigError && thrown.missing.includes(keyToDrop);
            }),
        );
    });
});
