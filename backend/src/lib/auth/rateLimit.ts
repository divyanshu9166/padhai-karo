/**
 * Fixed-window attempt limiter for the unauthenticated auth surface (login, register,
 * password reset).
 *
 * Counters live in Redis so limits hold across server instances. Redis is optional at
 * runtime: when it is unreachable (or during tests) the limiter degrades to an in-process
 * store rather than failing the request, so an infrastructure blip never locks every
 * student out of their account.
 *
 * The limiter uses a dedicated connection with a short command timeout instead of the
 * shared BullMQ connection, whose `maxRetriesPerRequest: null` would queue commands
 * indefinitely while Redis is down and stall the login request.
 */
import IORedis, { type Redis } from 'ioredis';

import { ErrorCode, errorResponse } from '@/lib/errors';

/** A named limit: at most `max` hits per `windowSec`-second window, per key. */
export interface RateLimitRule {
    name: string;
    max: number;
    windowSec: number;
}

export interface RateLimitStore {
    /** Current hit count and seconds until the window resets. */
    peek(key: string): Promise<{ count: number; ttlSec: number }>;
    /** Record one hit, starting the window on the first hit. Returns the new count. */
    hit(key: string, windowSec: number): Promise<number>;
    reset(key: string): Promise<void>;
}

/** Failed logins per email: 5 wrong passwords lock that email for 15 minutes. */
export const LOGIN_FAILURES_PER_EMAIL: RateLimitRule = { name: 'login-email', max: 5, windowSec: 15 * 60 };
/** Login attempts per client address, to slow credential stuffing across many emails. */
export const LOGIN_ATTEMPTS_PER_IP: RateLimitRule = { name: 'login-ip', max: 30, windowSec: 15 * 60 };
/** Account creations per client address. */
export const REGISTER_PER_IP: RateLimitRule = { name: 'register-ip', max: 10, windowSec: 60 * 60 };
/** Reset-code emails per account email. */
export const RESET_REQUESTS_PER_EMAIL: RateLimitRule = { name: 'reset-email', max: 3, windowSec: 60 * 60 };
/** Reset-code emails and confirmations per client address. */
export const RESET_ATTEMPTS_PER_IP: RateLimitRule = { name: 'reset-ip', max: 20, windowSec: 60 * 60 };

export class MemoryRateLimitStore implements RateLimitStore {
    private readonly windows = new Map<string, { count: number; resetAt: number }>();

    private live(key: string): { count: number; resetAt: number } | undefined {
        const entry = this.windows.get(key);
        if (entry && entry.resetAt <= Date.now()) {
            this.windows.delete(key);
            return undefined;
        }
        return entry;
    }

    async peek(key: string): Promise<{ count: number; ttlSec: number }> {
        const entry = this.live(key);
        return entry ? { count: entry.count, ttlSec: Math.ceil((entry.resetAt - Date.now()) / 1000) } : { count: 0, ttlSec: 0 };
    }

    async hit(key: string, windowSec: number): Promise<number> {
        const entry = this.live(key);
        if (entry) {
            entry.count += 1;
            return entry.count;
        }
        // Opportunistically bound memory: drop expired windows once the map grows large.
        if (this.windows.size > 10_000) {
            const now = Date.now();
            for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
        }
        this.windows.set(key, { count: 1, resetAt: Date.now() + windowSec * 1000 });
        return 1;
    }

    async reset(key: string): Promise<void> {
        this.windows.delete(key);
    }
}

class RedisRateLimitStore implements RateLimitStore {
    constructor(
        private readonly redis: Redis,
        private readonly fallback: RateLimitStore,
    ) {}

    async peek(key: string): Promise<{ count: number; ttlSec: number }> {
        try {
            const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
            return { count: Number(count ?? 0), ttlSec: Math.max(0, ttl) };
        } catch {
            return this.fallback.peek(key);
        }
    }

    async hit(key: string, windowSec: number): Promise<number> {
        try {
            // SET NX starts the window with its TTL; INCR keeps that TTL (works on every Redis version).
            const results = await this.redis.multi().set(key, 0, 'EX', windowSec, 'NX').incr(key).exec();
            const count = results?.[1]?.[1];
            if (typeof count !== 'number') throw new Error('Unexpected Redis INCR result.');
            return count;
        } catch {
            return this.fallback.hit(key, windowSec);
        }
    }

    async reset(key: string): Promise<void> {
        try {
            await this.redis.del(key);
        } catch {
            /* fall through to also clear the local fallback */
        }
        await this.fallback.reset(key);
    }
}

let store: RateLimitStore | undefined;

function defaultStore(): RateLimitStore {
    const memory = new MemoryRateLimitStore();
    const redisUrl = process.env.REDIS_URL?.trim();
    if (process.env.VITEST || !redisUrl) return memory;
    const redis = new IORedis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        commandTimeout: 750,
        connectTimeout: 2_000,
    });
    // Connection errors are handled per-command by the memory fallback.
    redis.on('error', () => undefined);
    return new RedisRateLimitStore(redis, memory);
}

export function getRateLimitStore(): RateLimitStore {
    store ??= defaultStore();
    return store;
}

/** Test hook: replace the backing store (pass `undefined` to restore the default). */
export function setRateLimitStore(next: RateLimitStore | undefined): void {
    store = next;
}

function storeKey(rule: RateLimitRule, subject: string): string {
    return `ratelimit:${rule.name}:${subject.toLowerCase()}`;
}

/** Seconds until `subject` may try again, or 0 when it is still under the limit. */
export async function retryAfterSec(rule: RateLimitRule, subject: string): Promise<number> {
    const { count, ttlSec } = await getRateLimitStore().peek(storeKey(rule, subject));
    return count >= rule.max ? Math.max(1, ttlSec) : 0;
}

export async function recordAttempt(rule: RateLimitRule, subject: string): Promise<void> {
    await getRateLimitStore().hit(storeKey(rule, subject), rule.windowSec);
}

export async function clearAttempts(rule: RateLimitRule, subject: string): Promise<void> {
    await getRateLimitStore().reset(storeKey(rule, subject));
}

/**
 * Check-and-count in one step for rules where every attempt counts (not only failures).
 * Returns the seconds to wait when the limit is already reached, otherwise records the hit
 * and returns 0.
 */
export async function consumeAttempt(rule: RateLimitRule, subject: string): Promise<number> {
    const wait = await retryAfterSec(rule, subject);
    if (wait > 0) return wait;
    await recordAttempt(rule, subject);
    return 0;
}

/**
 * Best-effort client address. Uses the first `X-Forwarded-For` hop set by the reverse
 * proxy (Caddy/Nginx/Vercel all set it); falls back to a shared bucket when absent.
 */
export function clientAddress(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export function tooManyAttemptsResponse(retryAfter: number): Response {
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    const response = errorResponse(
        429,
        ErrorCode.TOO_MANY_ATTEMPTS,
        `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        { retryAfterSec: retryAfter },
    );
    response.headers.set('Retry-After', String(retryAfter));
    return response;
}
