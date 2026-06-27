/**
 * Example (unit) test for the Topic Prioritization service handler (task 20.2;
 * design "Topic Prioritization endpoint (Req 8, 12)"; Req 12.2).
 *
 * This example pins the one behavior the pure modules cannot express on their own because it
 * depends on the handler's I/O orchestration: the per-Topic `Weak_Area_Score` map produced by
 * weak-area detection is *consumed* by topic prioritization (Req 12.2). The pure
 * `prioritizeTopics` is already property-tested in isolation (task 12.2, Property 10); what is
 * verified here is the wiring — that `topicPriorityHandler` obtains the per-Topic weak-area
 * map from the weak-area service and feeds it into the prioritization so that the map both
 * (a) propagates onto each `TopicPriority.weakAreaScore` and (b) influences ordering/flagging.
 *
 * Strategy:
 *   - Prisma is mocked with the `vi.hoisted` + `vi.mock('@/lib/db')` pattern (mirroring
 *     `rankPredictionService.test.ts`) so both the handler and the active-version resolver it
 *     calls read through the same in-memory client. Only the profile (Exam_Track) and the
 *     active topic-frequency dataset reads are exercised here.
 *   - `weakAreaService` is mocked directly (`vi.mock('./weakAreaService')`) so we control the
 *     exact `weakAreaScoreByTopic` map fed to prioritization — the cleanest way to assert the
 *     map drives the result, decoupled from the weak-area computation itself.
 *   - The track's Topic universe comes from the REAL `lib/reference` chapter catalog (not
 *     mocked), so the chosen `topicKey`s (`JEE-PHY-MECHANICS`, `JEE-PHY-KINEMATICS`) are real
 *     members of the JEE universe and therefore appear in the output.
 *
 * The two seeded topics are arranged so the weak-area map FLIPS the frequency-only ordering:
 *   - `JEE-PHY-KINEMATICS`: avgQuestionsPerYear = 4 (highest frequency), weakAreaScore = 0.
 *   - `JEE-PHY-MECHANICS` : avgQuestionsPerYear = 3, weakAreaScore = 100 (a strong weakness).
 * Frequency alone would rank KINEMATICS first; once the weak-area map is consumed, MECHANICS
 * outranks it — demonstrating the map is genuinely an input to prioritization.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const { profileFindUnique, topicFreqAggregate, topicFreqFindMany, getWeakAreaResultMock } =
    vi.hoisted(() => ({
        profileFindUnique: vi.fn(),
        topicFreqAggregate: vi.fn(),
        topicFreqFindMany: vi.fn(),
        getWeakAreaResultMock: vi.fn(),
    }));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        topicFrequencyReferenceData: {
            aggregate: topicFreqAggregate,
            findMany: topicFreqFindMany,
        },
    };
    return { default: prisma, prisma };
});

// Control the per-Topic weak-area score map directly (the cleaner approach for asserting the
// map feeds prioritization — Req 12.2).
vi.mock('./weakAreaService', () => ({
    getWeakAreaResult: getWeakAreaResultMock,
}));

import type { AuthContext } from '@/lib/auth';
import { topicPriorityHandler } from './topicPriorityService';
import type { TopicPriority } from './topicPriority';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function getReq(): Request {
    return new Request('http://localhost/api/analytics/topic-priority', { method: 'GET' });
}

// Two real JEE-track topic keys (members of the lib/reference chapter universe).
const HIGH_FREQ_TOPIC = 'JEE-PHY-KINEMATICS'; // highest frequency, NOT a weak area
const WEAK_TOPIC = 'JEE-PHY-MECHANICS'; // lower frequency, strong weak area
const WEAK_SCORE = 100;
const ACTIVE_YEAR = 2026;

beforeEach(() => {
    profileFindUnique.mockReset();
    topicFreqAggregate.mockReset();
    topicFreqFindMany.mockReset();
    getWeakAreaResultMock.mockReset();
});

describe('topicPriorityHandler — weak-area score map feeds prioritization (Req 12.2)', () => {
    it('propagates the per-Topic weakAreaScore and lets the map influence priority/ordering', async () => {
        profileFindUnique.mockResolvedValue({ examTrack: 'JEE' });
        // Active version = max referenceDataYear for the track (resolveActiveReferenceYear).
        topicFreqAggregate.mockResolvedValue({ _max: { referenceDataYear: ACTIVE_YEAR } });
        // Active topic-frequency rows for two real JEE topics; KINEMATICS has the higher
        // frequency so, on frequency alone, it would outrank MECHANICS.
        topicFreqFindMany.mockResolvedValue([
            {
                topicKey: HIGH_FREQ_TOPIC,
                appearanceCount: 40,
                yearSpanStart: 2014,
                yearSpanEnd: 2023,
                avgQuestionsPerYear: 4,
            },
            {
                topicKey: WEAK_TOPIC,
                appearanceCount: 30,
                yearSpanStart: 2014,
                yearSpanEnd: 2023,
                avgQuestionsPerYear: 3,
            },
        ]);
        // The user signal: a high weak-area score for MECHANICS, absent for KINEMATICS.
        getWeakAreaResultMock.mockResolvedValue({
            weakAreas: [],
            sessionTypeDistribution: [],
            weakAreaScoreByTopic: { [WEAK_TOPIC]: WEAK_SCORE },
        });

        const res = await topicPriorityHandler(getReq(), authCtx());

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            referenceDataYear: number;
            topics: TopicPriority[];
        };

        // Response shape (design Topic Prioritization endpoint): { referenceDataYear, topics }.
        expect(body.referenceDataYear).toBe(ACTIVE_YEAR);
        expect(Array.isArray(body.topics)).toBe(true);

        // The weak-area service was consulted for the requesting user (Req 12.2, 14.2).
        expect(getWeakAreaResultMock).toHaveBeenCalledWith('user-1');

        const weak = body.topics.find((t) => t.topicKey === WEAK_TOPIC);
        const highFreq = body.topics.find((t) => t.topicKey === HIGH_FREQ_TOPIC);
        expect(weak).toBeDefined();
        expect(highFreq).toBeDefined();

        // (a) The per-Topic weakAreaScore from the map is propagated onto the TopicPriority
        // entry; the topic absent from the map carries a 0 score.
        expect(weak!.weakAreaScore).toBe(WEAK_SCORE);
        expect(highFreq!.weakAreaScore).toBe(0);

        // (b) The map influences prioritization: although KINEMATICS has the higher raw
        // frequency, consuming the weak-area map pushes MECHANICS above it in priority and in
        // result ordering — proving the map is an input to the ranking, not ignored.
        expect(weak!.priority).toBeGreaterThan(highFreq!.priority);
        const weakIndex = body.topics.findIndex((t) => t.topicKey === WEAK_TOPIC);
        const highFreqIndex = body.topics.findIndex((t) => t.topicKey === HIGH_FREQ_TOPIC);
        expect(weakIndex).toBeLessThan(highFreqIndex);

        // The combined high-frequency-and-weak flag is also driven by the map: MECHANICS is
        // above the high-frequency threshold AND carries a positive weak-area score, so it is
        // flagged; KINEMATICS, with no weak-area score, is not.
        expect(weak!.isHighFreqAndWeak).toBe(true);
        expect(highFreq!.isHighFreqAndWeak).toBe(false);
    });
});
