import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Example (DB-independent) tests for the NTA Update Feed read service (task 17.2).
 *
 * The pure helpers (track→scopes mapping, where-clause building, client projection) are
 * exercised directly. The handler is exercised against a mocked Prisma client so we never
 * touch a live database — we only assert the behaviour the task specifies: track-filtering
 * from the Profile, most-recent-first ordering, the 404 when the user has no profile, and
 * that the response omits the internal `dedupeHash`.
 *
 * Properties 44–46 (worker concerns) belong to tasks 17.3–17.5; this task uses example
 * tests only.
 *
 * Validates: Requirements 20.5
 */

// --- Prisma mock -------------------------------------------------------------
// `vi.mock` is hoisted above the module body, so the mock fns must be created via
// `vi.hoisted` to be available inside the (also hoisted) factory.
const { findUniqueProfile, findManyAnnouncement } = vi.hoisted(() => ({
    findUniqueProfile: vi.fn(),
    findManyAnnouncement: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: findUniqueProfile },
        nTAAnnouncement: { findMany: findManyAnnouncement },
    };
    return { default: prisma, prisma };
});

import {
    buildNtaFeedWhere,
    NTA_FEED_ORDER_BY,
    NTA_FEED_SELECT,
    ntaFeedHandler,
    toClientAnnouncement,
    trackToExamScopes,
} from './ntaFeedService';
import type { AuthContext } from '@/lib/auth';

const BASE = 'http://localhost/api/nta/feed';

function get(): Request {
    return new Request(BASE);
}

function authCtx(userId = 'user-1'): AuthContext {
    // Only `user.id` is read by the handler; the rest is irrelevant to these tests.
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

beforeEach(() => {
    findUniqueProfile.mockReset();
    findManyAnnouncement.mockReset();
});

describe('trackToExamScopes', () => {
    it('maps JEE to both JEE_MAIN and JEE_ADVANCED', () => {
        expect(trackToExamScopes('JEE').sort()).toEqual(['JEE_ADVANCED', 'JEE_MAIN']);
    });

    it('maps NEET to NEET only', () => {
        expect(trackToExamScopes('NEET')).toEqual(['NEET']);
    });

    it('partitions all scopes across the two tracks with no overlap', () => {
        const jee = trackToExamScopes('JEE');
        const neet = trackToExamScopes('NEET');
        // Disjoint sets that together cover every known scope.
        expect(jee.some((s) => neet.includes(s))).toBe(false);
        expect([...jee, ...neet].sort()).toEqual(['JEE_ADVANCED', 'JEE_MAIN', 'NEET']);
    });
});

describe('buildNtaFeedWhere', () => {
    it('filters examScope by the JEE scope set (Req 20.5)', () => {
        const where = buildNtaFeedWhere('JEE');
        expect(where).toEqual({ examScope: { in: ['JEE_MAIN', 'JEE_ADVANCED'] } });
    });

    it('filters examScope by the NEET scope set (Req 20.5)', () => {
        const where = buildNtaFeedWhere('NEET');
        expect(where).toEqual({ examScope: { in: ['NEET'] } });
    });
});

describe('NTA_FEED_ORDER_BY', () => {
    it('orders most-recent-first by publishedAt with id as a stable tiebreaker', () => {
        expect(NTA_FEED_ORDER_BY).toEqual([{ publishedAt: 'desc' }, { id: 'asc' }]);
    });
});

describe('NTA_FEED_SELECT', () => {
    it('selects only display columns and never the internal dedupeHash', () => {
        expect('dedupeHash' in NTA_FEED_SELECT).toBe(false);
        expect(NTA_FEED_SELECT).toEqual({
            id: true,
            examScope: true,
            title: true,
            body: true,
            publishedAt: true,
            affectsExamDate: true,
            newExamDate: true,
        });
    });
});

describe('toClientAnnouncement', () => {
    it('projects to display fields and omits internal fields like dedupeHash', () => {
        const publishedAt = new Date('2025-01-01T00:00:00.000Z');
        const projected = toClientAnnouncement({
            id: 'a1',
            examScope: 'JEE_MAIN',
            title: 'Admit card released',
            body: 'Download your admit card.',
            publishedAt,
            affectsExamDate: false,
            newExamDate: null,
            // Extra fields that must never survive the projection.
            dedupeHash: 'deadbeef',
            createdAt: publishedAt,
            updatedAt: publishedAt,
        } as unknown as Parameters<typeof toClientAnnouncement>[0]);

        expect(projected).toEqual({
            id: 'a1',
            examScope: 'JEE_MAIN',
            title: 'Admit card released',
            body: 'Download your admit card.',
            publishedAt,
            affectsExamDate: false,
            newExamDate: null,
        });
        expect('dedupeHash' in projected).toBe(false);
        expect('createdAt' in projected).toBe(false);
    });
});

describe('ntaFeedHandler', () => {
    it('returns 404 when the user has no profile (no exam track)', async () => {
        findUniqueProfile.mockResolvedValue(null);
        const res = await ntaFeedHandler(get(), authCtx());
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('NOT_FOUND');
        expect(findManyAnnouncement).not.toHaveBeenCalled();
    });

    it("filters by the user's track scopes and orders most-recent-first (Req 20.5)", async () => {
        findUniqueProfile.mockResolvedValue({ examTrack: 'JEE' });
        const rows = [
            {
                id: 'a2',
                examScope: 'JEE_ADVANCED',
                title: 'Exam date changed',
                body: 'New date announced.',
                publishedAt: new Date('2025-02-01T00:00:00.000Z'),
                affectsExamDate: true,
                newExamDate: new Date('2025-05-20T00:00:00.000Z'),
            },
            {
                id: 'a1',
                examScope: 'JEE_MAIN',
                title: 'Admit card released',
                body: 'Download your admit card.',
                publishedAt: new Date('2025-01-15T00:00:00.000Z'),
                affectsExamDate: false,
                newExamDate: null,
            },
        ];
        findManyAnnouncement.mockResolvedValue(rows);

        const res = await ntaFeedHandler(get(), authCtx('user-42'));
        expect(res.status).toBe(200);

        // Profile is looked up scoped to the authenticated user.
        expect(findUniqueProfile).toHaveBeenCalledWith({
            where: { userId: 'user-42' },
            select: { examTrack: true },
        });

        // The query pins the track's scopes, selects only the safe columns, and orders
        // most-recent-first with id as a tiebreaker.
        expect(findManyAnnouncement).toHaveBeenCalledWith({
            where: { examScope: { in: ['JEE_MAIN', 'JEE_ADVANCED'] } },
            select: NTA_FEED_SELECT,
            orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        });

        const body = (await res.json()) as {
            announcements: Array<Record<string, unknown>>;
        };
        expect(body.announcements).toHaveLength(2);
        expect(body.announcements[0].id).toBe('a2');
        for (const a of body.announcements) {
            expect('dedupeHash' in a).toBe(false);
        }
    });

    it('uses the NEET scope set for a NEET user', async () => {
        findUniqueProfile.mockResolvedValue({ examTrack: 'NEET' });
        findManyAnnouncement.mockResolvedValue([]);

        const res = await ntaFeedHandler(get(), authCtx());
        expect(res.status).toBe(200);
        expect(findManyAnnouncement).toHaveBeenCalledWith({
            where: { examScope: { in: ['NEET'] } },
            select: NTA_FEED_SELECT,
            orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        });

        const body = (await res.json()) as { announcements: unknown[] };
        expect(body.announcements).toEqual([]);
    });
});
