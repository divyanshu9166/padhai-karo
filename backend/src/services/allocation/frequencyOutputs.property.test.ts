/**
 * Property-based test for the component-value / reference-year carriage of the
 * Allocation_Service frequency read outputs (task 10.3; design "Correctness
 * Properties → Property 6").
 *
 *   - Property 6: Frequency outputs carry their component values and reference year
 *     Validates: Requirements 4.2, 3.6
 *
 * Property 6 (design statement): For any returned Chapter in the `signal` or
 * `Most_Frequent_Chapters` output, the entry includes that Chapter's `PYQ_Chapter_Frequency`,
 * `Historical_Chapter_Frequency`, and `Combined_Weightage_Signal`, and the response includes the
 * `Reference_Data_Year` of the `TopicFrequencyReferenceData` used in the computation.
 *
 * Both read handlers (`signalHandler`, `mostFrequentChaptersHandler`) resolve the active
 * topic-frequency version via `resolveActiveReferenceYear(track, TOPIC_FREQUENCY)` and return
 * `{ referenceDataYear, chapters: ChapterSignal[] }` where each entry carries its component
 * frequency values (`pyqFrequency`, `historicalFrequency`, `hasHistoricalData`) plus the fused
 * `rawSignal` and normalized `combinedWeightageSignal`. The most-frequent handler reorders the
 * same entries, so the per-entry carriage property holds for both shapes.
 *
 * Strategy: Prisma is mocked through the `vi.hoisted` + `vi.mock('@/lib/db')` pattern (mirroring
 * `allocationReferenceYear.test.ts` / `missingInput.property.test.ts`) so the handlers read a
 * fully generated allocation universe through the in-memory client, and the shared active-version
 * resolver is mocked directly (`vi.mock('@/lib/analytics/referenceVersion')`) so each iteration
 * controls the active `Reference_Data_Year`. For every generated universe the expected component
 * values are derived independently from the pure `frequency.ts` derivations and the
 * `SIGNAL_WEIGHTS`, then matched against what each returned entry carries. The tier gate is
 * exercised for real (the allocation outputs default open for every tier).
 *
 * fast-check assertions run a minimum of 100 iterations each.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const {
    profileFindUnique,
    chapterFindMany,
    pyqAttemptFindMany,
    questionTopicMapFindMany,
    topicFrequencyFindMany,
} = vi.hoisted(() => ({
    profileFindUnique: vi.fn(),
    chapterFindMany: vi.fn(),
    pyqAttemptFindMany: vi.fn(),
    questionTopicMapFindMany: vi.fn(),
    topicFrequencyFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        chapter: { findMany: chapterFindMany },
        pYQAttempt: { findMany: pyqAttemptFindMany },
        questionTopicMap: { findMany: questionTopicMapFindMany },
        topicFrequencyReferenceData: { findMany: topicFrequencyFindMany },
    };
    return { default: prisma, prisma };
});

// Mock the shared active-version resolver directly so each iteration decides the active
// Reference_Data_Year echoed by the handlers (Req 3.6).
const { resolveActiveReferenceYearMock } = vi.hoisted(() => ({
    resolveActiveReferenceYearMock: vi.fn(),
}));

vi.mock('@/lib/analytics/referenceVersion', () => ({
    resolveActiveReferenceYear: resolveActiveReferenceYearMock,
}));

import type { AuthContext } from '@/lib/auth';
import {
    historicalChapterFrequency,
    pyqChapterFrequency,
    type AllocationChapter,
    type AttemptQuestionOutcome,
    type ChapterStatus,
    type QuestionTopicLink,
    type TopicFrequencyRecord,
} from '@/lib/allocation/frequency';
import { SIGNAL_WEIGHTS, type ChapterSignal } from '@/lib/allocation/signal';

import { signalHandler } from './signalService';
import { mostFrequentChaptersHandler } from './mostFrequentService';

// --- Generated allocation universe ------------------------------------------

interface ChapterRow {
    id: string;
    referenceKey: string;
    status: ChapterStatus;
    weightage: number | null;
    weightageIsDefault: boolean;
    weightageOverride: number | null;
    timeAllocationOverride: number | null;
}

interface Scenario {
    activeYear: number;
    chapterRows: ChapterRow[];
    attempts: { perQuestion: { questionId: string }[] }[];
    links: QuestionTopicLink[];
    records: TopicFrequencyRecord[];
}

const statusArb = fc.constantFrom<ChapterStatus>(
    'NOT_STARTED',
    'IN_PROGRESS',
    'DONE',
    'REVISED',
);

/**
 * Build a coherent allocation universe: a small pool of shared reference keys so Chapters,
 * QuestionTopicMap links, and TopicFrequencyReferenceData rows actually join (and some keys
 * deliberately miss), Chapters using those keys, attempted questions some of which are linked,
 * and active-year frequency records for a subset of the keys.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
    .uniqueArray(fc.hexaString({ minLength: 1, maxLength: 4 }).map((s) => `K-${s}`), {
        minLength: 1,
        maxLength: 5,
    })
    .chain((keys) =>
        fc
            .record({
                activeYear: fc.integer({ min: 2000, max: 2100 }),
                chapterRows: fc.uniqueArray(
                    fc.record({
                        id: fc.uuid(),
                        referenceKey: fc.constantFrom(...keys),
                        status: statusArb,
                        weightage: fc.option(fc.integer({ min: 0, max: 100 }), {
                            nil: null,
                        }),
                        weightageIsDefault: fc.boolean(),
                        weightageOverride: fc.option(fc.integer({ min: 0, max: 100 }), {
                            nil: null,
                        }),
                        timeAllocationOverride: fc.option(
                            fc.double({ min: 0, max: 1, noNaN: true }),
                            { nil: null },
                        ),
                    }),
                    { selector: (c) => c.id, minLength: 1, maxLength: 6 },
                ),
                questions: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 8 }),
            })
            .chain(({ activeYear, chapterRows, questions }) =>
                fc
                    .record({
                        // Each link maps a question to one of the shared keys (some keys may
                        // match a Chapter referenceKey, some may not).
                        links: fc.array(
                            fc.record({
                                questionId: fc.constantFrom(...questions),
                                topicKey: fc.constantFrom(...keys),
                            }),
                            { maxLength: 12 },
                        ),
                        // Each attempt records a set of attempted questions (drawn from the
                        // pool, so some resolve through links and some do not).
                        attempts: fc.array(
                            fc.record({
                                perQuestion: fc.array(
                                    fc.record({
                                        questionId: fc.constantFrom(...questions),
                                    }),
                                    { maxLength: 6 },
                                ),
                            }),
                            { maxLength: 5 },
                        ),
                        // Active-year frequency rows for a subset of the keys.
                        records: fc.uniqueArray(
                            fc.record({
                                topicKey: fc.constantFrom(...keys),
                                avgQuestionsPerYear: fc.double({
                                    min: 0,
                                    max: 50,
                                    noNaN: true,
                                }),
                            }),
                            { selector: (r) => r.topicKey, maxLength: keys.length },
                        ),
                    })
                    .map(({ links, attempts, records }) => ({
                        activeYear,
                        chapterRows,
                        attempts,
                        links,
                        records,
                    })),
            ),
    );

function authCtx(userId = 'user-1'): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function getReq(path: string): Request {
    return new Request(`http://localhost${path}`, { method: 'GET' });
}

/** Wire the Prisma + resolver mocks to serve one generated scenario. */
function primeMocks(scenario: Scenario): void {
    profileFindUnique.mockResolvedValue({
        examTrack: 'JEE',
        language: 'EN',
        subscriptionTier: 'FREE',
    });
    resolveActiveReferenceYearMock.mockResolvedValue(scenario.activeYear);
    chapterFindMany.mockResolvedValue(scenario.chapterRows);
    pyqAttemptFindMany.mockResolvedValue(
        scenario.attempts.map((a) => ({ perQuestion: a.perQuestion })),
    );
    questionTopicMapFindMany.mockResolvedValue(scenario.links);
    topicFrequencyFindMany.mockResolvedValue(scenario.records);
}

/**
 * Independently derive the expected per-Chapter component values for a scenario, using the same
 * pure derivations the handler delegates to (Req 1, 2, 3): effective weightage applies
 * `weightageOverride ?? weightage`; outcomes flatten every attempt's per-question entries.
 */
function expectedComponents(scenario: Scenario): Map<
    string,
    { pyqFrequency: number; historicalFrequency: number; hasHistoricalData: boolean }
> {
    const chapters: AllocationChapter[] = scenario.chapterRows.map((row) => ({
        id: row.id,
        referenceKey: row.referenceKey,
        status: row.status,
        weightage: row.weightageOverride ?? row.weightage,
        weightageIsDefault: row.weightageIsDefault,
    }));
    const outcomes: AttemptQuestionOutcome[] = scenario.attempts.flatMap((a) =>
        a.perQuestion.map((q) => ({ questionId: q.questionId })),
    );

    const pyqByChapter = pyqChapterFrequency(outcomes, scenario.links, chapters);
    const historicalByChapter = historicalChapterFrequency(chapters, scenario.records);

    const expected = new Map<
        string,
        { pyqFrequency: number; historicalFrequency: number; hasHistoricalData: boolean }
    >();
    for (const chapter of chapters) {
        const historical = historicalByChapter.get(chapter.id);
        expected.set(chapter.id, {
            pyqFrequency: pyqByChapter.get(chapter.id) ?? 0,
            historicalFrequency: historical?.value ?? 0,
            hasHistoricalData: historical?.hasHistoricalData ?? false,
        });
    }
    return expected;
}

/**
 * Assert each returned Chapter entry carries its component frequency values and a fused signal,
 * and that the response carries the active Reference_Data_Year (Property 6).
 */
function assertCarriesComponentsAndYear(
    body: { referenceDataYear: number; chapters: ChapterSignal[] },
    scenario: Scenario,
): void {
    // The response carries the active Reference_Data_Year used in the computation (Req 3.6, 4.2).
    expect(body.referenceDataYear).toBe(scenario.activeYear);

    const expected = expectedComponents(scenario);

    // Every Chapter is represented exactly once (the output reorders but never drops/adds).
    const returnedIds = body.chapters.map((c) => c.chapterId).sort();
    const expectedIds = [...expected.keys()].sort();
    expect(returnedIds).toEqual(expectedIds);

    for (const entry of body.chapters) {
        const want = expected.get(entry.chapterId);
        expect(want).toBeDefined();
        if (!want) {
            continue;
        }

        // Component values are present and equal the independently-derived frequencies.
        expect(entry).toHaveProperty('pyqFrequency');
        expect(entry).toHaveProperty('historicalFrequency');
        expect(entry).toHaveProperty('hasHistoricalData');
        expect(entry.pyqFrequency).toBe(want.pyqFrequency);
        expect(entry.historicalFrequency).toBeCloseTo(want.historicalFrequency, 10);
        expect(entry.hasHistoricalData).toBe(want.hasHistoricalData);

        // The fused Combined_Weightage_Signal is present: raw fusion plus a normalized value.
        expect(entry).toHaveProperty('rawSignal');
        expect(entry).toHaveProperty('combinedWeightageSignal');
        expect(entry.rawSignal).toBeCloseTo(
            SIGNAL_WEIGHTS.pyq * want.pyqFrequency +
                SIGNAL_WEIGHTS.historical * want.historicalFrequency,
            10,
        );
        expect(typeof entry.combinedWeightageSignal).toBe('number');
        expect(entry.combinedWeightageSignal).toBeGreaterThanOrEqual(0);
        expect(entry.combinedWeightageSignal).toBeLessThanOrEqual(1);
    }
}

beforeEach(() => {
    profileFindUnique.mockReset();
    chapterFindMany.mockReset();
    pyqAttemptFindMany.mockReset();
    questionTopicMapFindMany.mockReset();
    topicFrequencyFindMany.mockReset();
    resolveActiveReferenceYearMock.mockReset();
});

describe('Allocation_Service frequency outputs carry component values and year (Property 6)', () => {
    // Feature: weightage-based-time-allocation, Property 6: Frequency outputs carry their
    // component values and reference year
    it('Property 6: signal entries carry PYQ + historical components, signal, and the year (Req 4.2, 3.6)', async () => {
        await fc.assert(
            fc.asyncProperty(scenarioArb, async (scenario) => {
                primeMocks(scenario);

                const res = await signalHandler(getReq('/api/allocation/signal'), authCtx());

                expect(res.status).toBe(200);
                const body = (await res.json()) as {
                    referenceDataYear: number;
                    chapters: ChapterSignal[];
                };
                assertCarriesComponentsAndYear(body, scenario);
            }),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 6: Frequency outputs carry their
    // component values and reference year
    it('Property 6: most-frequent entries carry PYQ + historical components, signal, and the year (Req 4.2, 3.6)', async () => {
        await fc.assert(
            fc.asyncProperty(scenarioArb, async (scenario) => {
                primeMocks(scenario);

                const res = await mostFrequentChaptersHandler(
                    getReq('/api/allocation/most-frequent-chapters'),
                    authCtx(),
                );

                expect(res.status).toBe(200);
                const body = (await res.json()) as {
                    referenceDataYear: number;
                    chapters: ChapterSignal[];
                };
                assertCarriesComponentsAndYear(body, scenario);
            }),
            { numRuns: 100 },
        );
    });
});
