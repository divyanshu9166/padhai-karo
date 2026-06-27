import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the Daily Time Audit service handler (task 10.1).
 *
 * The handler is exercised against a mocked Prisma client so we never touch a live
 * database. We assert the behaviour the task specifies: validation rejection (422), the
 * UTC-day normalization + focus-session window query, actual-time derivation from sessions
 * vs the user-entered fallback (Req 14.2/14.3), and the upsert-on-(userId, date) so a
 * re-submission updates rather than failing the unique constraint, always user-scoped.
 *
 * The numbered property test (Property 27) is task 10.3; this task uses example tests only.
 *
 * Validates: Requirements 14.1, 14.2, 14.3
 */

// --- Prisma mock -------------------------------------------------------------
const { findManySessions, upsertAudit } = vi.hoisted(() => ({
    findManySessions: vi.fn(),
    upsertAudit: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        focusSession: { findMany: findManySessions },
        dailyTimeAudit: { upsert: upsertAudit },
    };
    return { default: prisma, prisma };
});

import { recordDailyAuditHandler } from './auditService';
import type { AuthContext } from '@/lib/auth';

function authCtx(userId = 'user-1'): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/audits/daily', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

beforeEach(() => {
    findManySessions.mockReset();
    upsertAudit.mockReset();
});

describe('recordDailyAuditHandler', () => {
    it('returns 422 when the body is not a JSON object', async () => {
        const res = await recordDailyAuditHandler(postReq('oops'), authCtx());
        expect(res.status).toBe(422);
        expect(findManySessions).not.toHaveBeenCalled();
        expect(upsertAudit).not.toHaveBeenCalled();
    });

    it('returns 422 on invalid input without touching the DB', async () => {
        const res = await recordDailyAuditHandler(
            postReq({ date: 'not-a-date', plannedMin: 60 }),
            authCtx(),
        );
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(findManySessions).not.toHaveBeenCalled();
        expect(upsertAudit).not.toHaveBeenCalled();
    });

    it('derives actual from the day\'s focus sessions when present (Req 14.2)', async () => {
        findManySessions.mockResolvedValue([
            { focusedDurationMin: 40 },
            { focusedDurationMin: 35 },
        ]);
        upsertAudit.mockResolvedValue({ id: 'a1', actualMin: 75 });

        const res = await recordDailyAuditHandler(
            postReq({ date: '2025-03-14T09:00:00.000Z', plannedMin: 120, actualMin: 5 }),
            authCtx('user-1'),
        );
        expect(res.status).toBe(201);

        // Sessions are queried within the UTC day window, scoped to the user.
        expect(findManySessions).toHaveBeenCalledTimes(1);
        const findArg = findManySessions.mock.calls[0][0];
        expect(findArg.where.userId).toBe('user-1');
        expect(findArg.where.startTime.gte.toISOString()).toBe('2025-03-14T00:00:00.000Z');
        expect(findArg.where.startTime.lt.toISOString()).toBe('2025-03-15T00:00:00.000Z');

        // Upsert keyed on (userId, date) normalized to UTC midnight; sessions win over the
        // user-entered actualMin of 5.
        const upsertArg = upsertAudit.mock.calls[0][0];
        expect(upsertArg.where).toEqual({
            userId_date: { userId: 'user-1', date: new Date('2025-03-14T00:00:00.000Z') },
        });
        expect(upsertArg.create).toEqual({
            userId: 'user-1',
            date: new Date('2025-03-14T00:00:00.000Z'),
            plannedMin: 120,
            actualMin: 75,
        });
        expect(upsertArg.update).toEqual({ plannedMin: 120, actualMin: 75 });
    });

    it('uses the user-entered value when the day has no sessions (Req 14.3)', async () => {
        findManySessions.mockResolvedValue([]);
        upsertAudit.mockResolvedValue({ id: 'a2', actualMin: 100 });

        const res = await recordDailyAuditHandler(
            postReq({ date: '2025-03-14', plannedMin: 90, actualMin: 100 }),
            authCtx('user-7'),
        );
        expect(res.status).toBe(201);
        const upsertArg = upsertAudit.mock.calls[0][0];
        expect(upsertArg.create.actualMin).toBe(100);
        expect(upsertArg.update.actualMin).toBe(100);
    });

    it('defaults actual to 0 when neither sessions nor an entered value exist', async () => {
        findManySessions.mockResolvedValue([]);
        upsertAudit.mockResolvedValue({ id: 'a3', actualMin: 0 });

        const res = await recordDailyAuditHandler(
            postReq({ date: '2025-03-14', plannedMin: 90 }),
            authCtx(),
        );
        expect(res.status).toBe(201);
        expect(upsertAudit.mock.calls[0][0].create.actualMin).toBe(0);
    });

    it('upserts (does not fail) so a re-submission updates the same day', async () => {
        findManySessions.mockResolvedValue([{ focusedDurationMin: 60 }]);
        upsertAudit.mockResolvedValue({ id: 'a4', actualMin: 60 });

        const res = await recordDailyAuditHandler(
            postReq({ date: '2025-03-14', plannedMin: 200 }),
            authCtx('user-1'),
        );
        expect(res.status).toBe(201);
        // The write is an upsert (not a create), keyed on the composite unique constraint.
        expect(upsertAudit).toHaveBeenCalledTimes(1);
        expect(upsertAudit.mock.calls[0][0].where).toHaveProperty('userId_date');
    });

    it('returns the persisted audit in the response body', async () => {
        findManySessions.mockResolvedValue([]);
        upsertAudit.mockResolvedValue({ id: 'a5', plannedMin: 30, actualMin: 10 });

        const res = await recordDailyAuditHandler(
            postReq({ date: '2025-03-14', plannedMin: 30, actualMin: 10 }),
            authCtx(),
        );
        const body = (await res.json()) as { audit: { id: string } };
        expect(body.audit.id).toBe('a5');
    });
});
