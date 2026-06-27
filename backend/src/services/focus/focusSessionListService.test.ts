import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the focus-session listing service (task 8.2).
 *
 * The pure helpers (range parsing/validation and where-clause building) are exercised
 * directly. The handler is exercised against a mocked Prisma client so we never touch a
 * live database — we only assert the behaviour the task specifies: from/to validation
 * (422), per-user scoping by `userId`, the `startTime` range filter, and deterministic
 * most-recent-first ordering.
 *
 * Validates: Requirements 4.3
 */

// --- Prisma mock -------------------------------------------------------------
// `vi.mock` is hoisted above the module body, so the mock fns must be created via
// `vi.hoisted` to be available inside the (also hoisted) factory.
const { findManyFocusSession } = vi.hoisted(() => ({
    findManyFocusSession: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        focusSession: { findMany: findManyFocusSession },
    };
    return { default: prisma, prisma };
});

import {
    buildFocusSessionWhere,
    FOCUS_SESSION_ORDER_BY,
    listFocusSessionsHandler,
    parseFocusSessionRange,
} from './focusSessionListService';
import type { AuthContext } from '@/lib/auth';

const BASE = 'http://localhost/api/focus-sessions';
const FROM = '2026-01-01T00:00:00.000Z';
const TO = '2026-01-31T23:59:59.000Z';

function get(query = ''): Request {
    return new Request(`${BASE}${query}`);
}

function authCtx(userId = 'user-1'): AuthContext {
    // Only `user.id` is read by the handler; the rest is irrelevant to these tests.
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

beforeEach(() => {
    findManyFocusSession.mockReset();
});

describe('parseFocusSessionRange', () => {
    it('returns an open range when from/to are absent', () => {
        const parsed = parseFocusSessionRange(new URL(BASE));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.range).toEqual({ from: null, to: null });
        }
    });

    it('parses valid ISO from/to into Dates', () => {
        const parsed = parseFocusSessionRange(
            new URL(`${BASE}?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`),
        );
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.range.from).toEqual(new Date(FROM));
            expect(parsed.range.to).toEqual(new Date(TO));
        }
    });

    it('parses an epoch-millis timestamp', () => {
        const millis = Date.parse(FROM);
        const parsed = parseFocusSessionRange(new URL(`${BASE}?from=${millis}`));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.range.from).toEqual(new Date(millis));
            expect(parsed.range.to).toBeNull();
        }
    });

    it('accepts only one bound (from)', () => {
        const parsed = parseFocusSessionRange(new URL(`${BASE}?from=${encodeURIComponent(FROM)}`));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.range.from).toEqual(new Date(FROM));
            expect(parsed.range.to).toBeNull();
        }
    });

    it.each(['not-a-date', '2026-13-45T99:99:99Z'])(
        'rejects an invalid from %j with a 422 response',
        (from) => {
            const parsed = parseFocusSessionRange(
                new URL(`${BASE}?from=${encodeURIComponent(from)}`),
            );
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) {
                expect(parsed.response.status).toBe(422);
            }
        },
    );

    it('rejects an invalid to with a 422 response', () => {
        const parsed = parseFocusSessionRange(new URL(`${BASE}?to=not-a-date`));
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.response.status).toBe(422);
        }
    });

    it('rejects from later than to with a 422 response', () => {
        const parsed = parseFocusSessionRange(
            new URL(`${BASE}?from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`),
        );
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.response.status).toBe(422);
        }
    });

    it('accepts from equal to to (boundary)', () => {
        const parsed = parseFocusSessionRange(
            new URL(`${BASE}?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(FROM)}`),
        );
        expect(parsed.ok).toBe(true);
    });
});

describe('buildFocusSessionWhere', () => {
    it('pins userId and adds no startTime filter for an open range', () => {
        const where = buildFocusSessionWhere('user-1', { from: null, to: null });
        expect(where).toEqual({ userId: 'user-1' });
    });

    it('applies both bounds when present', () => {
        const from = new Date(FROM);
        const to = new Date(TO);
        const where = buildFocusSessionWhere('user-1', { from, to });
        expect(where).toEqual({ userId: 'user-1', startTime: { gte: from, lte: to } });
    });

    it('applies only the from bound when to is absent', () => {
        const from = new Date(FROM);
        const where = buildFocusSessionWhere('user-1', { from, to: null });
        expect(where).toEqual({ userId: 'user-1', startTime: { gte: from } });
    });

    it('applies only the to bound when from is absent', () => {
        const to = new Date(TO);
        const where = buildFocusSessionWhere('user-1', { from: null, to });
        expect(where).toEqual({ userId: 'user-1', startTime: { lte: to } });
    });
});

describe('FOCUS_SESSION_ORDER_BY', () => {
    it('orders most-recent-first by startTime with id as a stable tiebreaker', () => {
        expect(FOCUS_SESSION_ORDER_BY).toEqual([{ startTime: 'desc' }, { id: 'asc' }]);
    });
});

describe('listFocusSessionsHandler', () => {
    it('returns 422 when from is invalid (no DB access)', async () => {
        const res = await listFocusSessionsHandler(get('?from=not-a-date'), authCtx());
        expect(res.status).toBe(422);
        expect(findManyFocusSession).not.toHaveBeenCalled();
    });

    it('returns 422 when from is later than to (no DB access)', async () => {
        const res = await listFocusSessionsHandler(
            get(`?from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`),
            authCtx(),
        );
        expect(res.status).toBe(422);
        expect(findManyFocusSession).not.toHaveBeenCalled();
    });

    it('scopes by userId and applies the range filter, ordered most-recent-first', async () => {
        const rows = [
            { id: 's2', userId: 'user-42', startTime: new Date('2026-01-20T10:00:00.000Z') },
            { id: 's1', userId: 'user-42', startTime: new Date('2026-01-05T10:00:00.000Z') },
        ];
        findManyFocusSession.mockResolvedValue(rows);

        const res = await listFocusSessionsHandler(
            get(`?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`),
            authCtx('user-42'),
        );
        expect(res.status).toBe(200);

        expect(findManyFocusSession).toHaveBeenCalledWith({
            where: {
                userId: 'user-42',
                startTime: { gte: new Date(FROM), lte: new Date(TO) },
            },
            orderBy: [{ startTime: 'desc' }, { id: 'asc' }],
        });

        const body = (await res.json()) as { sessions: Array<Record<string, unknown>> };
        expect(body.sessions).toHaveLength(2);
        expect(body.sessions[0].id).toBe('s2');
    });

    it('lists all of the user\'s sessions when no range is provided', async () => {
        findManyFocusSession.mockResolvedValue([]);

        const res = await listFocusSessionsHandler(get(), authCtx('user-7'));
        expect(res.status).toBe(200);

        expect(findManyFocusSession).toHaveBeenCalledWith({
            where: { userId: 'user-7' },
            orderBy: [{ startTime: 'desc' }, { id: 'asc' }],
        });

        const body = (await res.json()) as { sessions: unknown[] };
        expect(body.sessions).toEqual([]);
    });
});
