/**
 * Server-side-only configuration loader.
 *
 * Per design "Security Considerations: Transport & Secrets", provider keys (AI,
 * Razorpay), the database URL, the Redis URL, and the webhook secret live in
 * server-side environment configuration only and are NEVER shipped to the client or
 * exposed via OTA bundles. This module is the single typed entry point for reading
 * those values. It must only ever be imported from server-side code (API route
 * handlers, services, workers) — never from client/shared bundles.
 *
 * Required variables are validated up front (`loadConfig`) so the process fails fast
 * with a clear, aggregated error listing every missing variable rather than throwing
 * an opaque `undefined` deep inside a request.
 */

/** Typed, structured view of the server-side configuration. */
export interface AppConfig {
    /** PostgreSQL connection string consumed by Prisma (`DATABASE_URL`). */
    databaseUrl: string;
    /** Redis connection string consumed by BullMQ / ioredis (`REDIS_URL`). */
    redisUrl: string;
    ai: {
        /** Vision/text AI provider API key (`AI_PROVIDER_API_KEY`). */
        apiKey: string;
    };
    razorpay: {
        /** Razorpay key id (`RAZORPAY_KEY_ID`). */
        keyId: string;
        /** Razorpay key secret (`RAZORPAY_KEY_SECRET`). */
        keySecret: string;
        /** Razorpay webhook signing secret (`RAZORPAY_WEBHOOK_SECRET`). */
        webhookSecret: string;
    };
}

/** A minimal, read-only view of an environment-variable bag. */
export type EnvSource = Record<string, string | undefined>;

/**
 * The required environment variables and how each maps into {@link AppConfig}.
 * Centralizing this list keeps validation, the error message, and `.env.example`
 * in lock-step.
 */
const REQUIRED_ENV_VARS = [
    'DATABASE_URL',
    'REDIS_URL',
    'AI_PROVIDER_API_KEY',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

/** Thrown when one or more required server-side environment variables are missing. */
export class ConfigError extends Error {
    /** The names of the environment variables that were missing or empty. */
    readonly missing: readonly string[];

    constructor(missing: readonly string[]) {
        super(
            `Missing required server-side environment variable(s): ${missing.join(', ')}. ` +
            `Set them in your environment (see .env.example). These are server-only secrets ` +
            `and must never be bundled into the mobile client.`,
        );
        this.name = 'ConfigError';
        this.missing = missing;
    }
}

/**
 * Treats `undefined`, `null`, and whitespace-only strings as "not provided" so a blank
 * line in a `.env` file does not silently pass validation.
 */
function readRequired(env: EnvSource, key: RequiredEnvVar, missing: string[]): string {
    const value = env[key];
    if (value === undefined || value.trim() === '') {
        missing.push(key);
        return '';
    }
    return value;
}

/**
 * Validate and parse a configuration object from the given environment source.
 *
 * Pure with respect to the passed `env`: it neither reads `process.env` directly nor
 * caches, which makes it trivial to unit test with a mocked environment. Throws
 * {@link ConfigError} listing every missing variable when validation fails.
 */
export function loadConfig(env: EnvSource): AppConfig {
    const missing: string[] = [];

    const databaseUrl = readRequired(env, 'DATABASE_URL', missing);
    const redisUrl = readRequired(env, 'REDIS_URL', missing);
    const aiApiKey = readRequired(env, 'AI_PROVIDER_API_KEY', missing);
    const razorpayKeyId = readRequired(env, 'RAZORPAY_KEY_ID', missing);
    const razorpayKeySecret = readRequired(env, 'RAZORPAY_KEY_SECRET', missing);
    const razorpayWebhookSecret = readRequired(env, 'RAZORPAY_WEBHOOK_SECRET', missing);

    if (missing.length > 0) {
        throw new ConfigError(missing);
    }

    return {
        databaseUrl,
        redisUrl,
        ai: { apiKey: aiApiKey },
        razorpay: {
            keyId: razorpayKeyId,
            keySecret: razorpayKeySecret,
            webhookSecret: razorpayWebhookSecret,
        },
    };
}

let cached: AppConfig | undefined;

/**
 * Returns the validated server-side configuration, reading from `process.env` and
 * caching the result for the lifetime of the process.
 *
 * Guards against accidental client-bundle usage: if a browser-like global is detected
 * this throws, because these values are secrets that must never reach the client.
 * Validation is lazy (on first call) so importing this module never crashes a context
 * that does not actually need the secrets (e.g. the test runner loading unrelated code).
 */
export function getConfig(): AppConfig {
    if (typeof window !== 'undefined') {
        throw new Error(
            'getConfig() was called in a browser context. Server-side secrets must never be ' +
            'accessed from client code.',
        );
    }
    if (cached === undefined) {
        cached = loadConfig(process.env);
    }
    return cached;
}

/** Test-only helper to reset the memoized config between cases. */
export function resetConfigCache(): void {
    cached = undefined;
}
