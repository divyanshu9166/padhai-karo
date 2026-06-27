/**
 * Unit test for active `Reference_Data_Year` presence in the allocation read responses
 * (task 10.4; design "Service layer → allocation endpoints"; Req 3.6).
 *
 * Both read endpoints — `GET /api/allocation/signal` (`signalHandler`) and
 * `GET /api/allocation/most-frequent-chapters` (`mostFrequentChaptersHandler`) — resolve the
 * active topic-frequency version via `resolveActiveReferenceYear(track, TOPIC_FREQUENCY)` and
 * echo it back to the client as `referenceDataYear` on the 200 payload (Req 3.6, 4.2). This is
 * an I/O-orchestration behavior the pure `src/lib/allocation/*` modules cannot express on their
 * own, so it is pinned here at the handler boundary.
 *
 * Strategy: Prisma is mocked with the `vi.hoisted` + `vi.mock('@/lib/db')` pattern (mirroring
 * `topicPriorityService.test.ts` / `rankPredictionService.test.ts`) so both the handlers and the
 * shared `resolveActiveReferenceYear` resolver they call read through the same in-memory client.
 * The active version is the max `referenceDataYear` for the track, so the resolver's
 * `topicFrequencyReferenceData.aggregate` is stubbed to return that max. The per-user reads
 * (chapters, PYQ attempts, active-year frequency rows) are stubbed minimally — the assertion is
 * only that the resolved year appears in the response, independent of the computed signal — and
 * the tier gate is exercised for real (the allocation outputs default open for every tier).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const {
    profileFindUnique,
    topicFreqAggregate,
    topicFreqFindMany,
    chapterFindMany,
    pyqAttemptFindMany,
    questionTopicMapFindMany,
} = vi.hoisted(() => ({
    profileFindUnique: vi.fn(),
    topicFreqAggregate: vi.fn(),
    topicFreqFindMany: vi.fn(),
    chapterFindMany: vi.fn(),
    pyqAttemptFindMany: vi.fn(),
    questionTopicMapFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        topicFrequencyReferenceData: {
            aggregate: topicFreqAggregate,
            findMany: topicFreqFindMany,
        },
        chapter: { findMany: chapterFindMany },
        pYQAttempt: { findMany: pyqAttemptFindMany },
        questionTopicMap: { findMany: questionTopicMapFindMany },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';
import { signalHandler } from './signalService';
import { mostFrequentChaptersHandler } from './mostFrequentService';

const ACTIVE_YEAR = 2026;

function authCtx(userId = 'user-1'): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function getReq(path: string): Request {
    return new Request(`http://localhost${path}`, { method: 'GET' });
}

beforeEach(() => {
    profileFindUnique.mockReset();
    topicFreqAggregate.mockReset();
    topicFreqFindMany.mockReset();
    chapterFindMany.mockReset();
    pyqAttemptFindMany.mockReset();
    questionTopicMapFindMany.mockReset();

    // An onboarded JEE user on the default (Free) tier — the allocation outputs default open.
    profileFindUnique.mockResolvedValue({
        examTrack: 'JEE',
        language: 'EN',
        subscriptionTier: 'FREE',
    });
    // Active version = max referenceDataYear for the track (resolveActiveReferenceYear).
    topicFreqAggregate.mockResolvedValue({ _max: { referenceDataYear: ACTIVE_YEAR } });
    // Minimal per-user / reference reads — the resolved year must surface regardless of signal.
    chapterFindMany.mockResolvedValue([
        {
            id: 'chapter-1',
            referenceKey: 'JEE-PHY-MECHANICS',
            status: 'NOT_STARTED',
            weightage: 10,
            weightageIsDefault: false,
            weightageOverride: null,
            timeAllocationOverride: null,
        },
    ]);
    pyqAttemptFindMany.mockResolvedValue([]);
    topicFreqFindMany.mockResolvedValue([]);
    questionTopicMapFindMany.mockResolvedValue([]);
});

describe('allocation read endpoints echo the active Reference_Data_Year (Req 3.6)', () => {
    it('signalHandler 200 response includes referenceDataYear equal to the active year', async () => {
        const res = await signalHandler(getReq('/api/allocation/signal'), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as { referenceDataYear: number; chapters: unknown[] };
        expect(body.referenceDataYear).toBe(ACTIVE_YEAR);
        expect(Array.isArray(body.chapters)).toBe(true);
    });

    it('mostFrequentChaptersHandler 200 response includes referenceDataYear equal to the active year', async () => {
        const res = await mostFrequentChaptersHandler(
            getReq('/api/allocation/most-frequent-chapters'),
            authCtx(),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { referenceDataYear: number; chapters: unknown[] };
        expect(body.referenceDataYear).toBe(ACTIVE_YEAR);
        expect(Array.isArray(body.chapters)).toBe(true);
    });
});
