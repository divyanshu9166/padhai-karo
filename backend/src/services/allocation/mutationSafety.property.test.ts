/**
 * Property-based test for allocation mutation safety (task 13.1; design
 * "Correctness Properties → Property 12").
 *
 *   - Property 12: Computations never mutate existing records
 *     Validates: Requirements 1.6, 2.5, 7.5, 8.3, 9.4
 *
 * Property 12 (design statement): For any allocation computation (signal,
 * most-frequent, suggested-allocation, or timetable-basis resolution), no
 * `PYQAttempt`, `QuestionTopicMap`, `PYQ`, `TopicFrequencyReferenceData`, or
 * existing `Chapter` value (including `weightage`, `weightageOverride`, and
 * `timeAllocationOverride`) is created, updated, or deleted.
 *
 * The property is asserted at the two layers where "no mutation" is meaningful:
 *
 *  1. Pure layer (`src/lib/allocation/*`). The frequency, signal, ranking,
 *     suggested-allocation, and timetable-basis functions are documented as
 *     mutation-free — they read their inputs and build fresh outputs. This test
 *     enforces that contract structurally: every input is recursively
 *     `Object.freeze`d, so any attempted in-place write would throw in the
 *     module's strict-mode context, and is also deep-cloned beforehand so the
 *     input can be asserted structurally unchanged (deep-equal) after the call.
 *     Feeding deep-frozen inputs to each pure function must never throw.
 *
 *  2. Service layer (`signalHandler`, `mostFrequentChaptersHandler`,
 *     `suggestedAllocationHandler`). Across the three read handlers the only
 *     Prisma write that may be invoked is `suggestedAllocationSnapshot.upsert`
 *     (the new Phase 2 model). No create/update/delete/upsert is ever issued
 *     against `Profile`, `Chapter`, `PYQAttempt`, `QuestionTopicMap`, or
 *     `TopicFrequencyReferenceData` (Req 9.4). Every Prisma method is a spy, so
 *     the test asserts the existing-model write spies are never called while the
 *     handlers still complete their full computation (HTTP 200).
 *
 * Following the established analytics service-test convention (see
 * `missingInput.property.test.ts`): Prisma is mocked through `vi.hoisted` +
 * `vi.mock('@/lib/db')`, and the active-version resolver is mocked via
 * `vi.mock('@/lib/analytics/referenceVersion')`.
 *
 * fast-check assertions run a minimum of 100 iterations each.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
// Every model exposes the full read + write surface as spies so the test can
// assert exactly which writes the read handlers reach.
const { prismaMock } = vi.hoisted(() => {
    const makeModel = () => ({
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        createMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
    });
    return {
        prismaMock: {
            profile: makeModel(),
            chapter: makeModel(),
            pYQAttempt: makeModel(),
            questionTopicMap: makeModel(),
            topicFrequencyReferenceData: makeModel(),
            suggestedAllocationSnapshot: makeModel(),
        },
    };
});

vi.mock('@/lib/db', () => ({ default: prismaMock, prisma: prismaMock }));

// Mock the shared active-version resolver so each iteration supplies a concrete
// active reference year (the required reference data is "present").
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
import {
    combinedWeightageSignal,
    type ChapterSignal,
    type ChapterSignalInput,
} from '@/lib/allocation/signal';
import { mostFrequentChapters } from '@/lib/allocation/ranking';
import {
    suggestedTimeAllocation,
    type SuggestedChapterInput,
} from '@/lib/allocation/allocation';
import {
    resolveTimetableBasis,
    type AllocatorChapterLike,
    type EffectiveAllocationMode,
} from '@/lib/allocation/timetableBasis';

import { signalHandler } from './signalService';
import { mostFrequentChaptersHandler } from './mostFrequentService';
import { suggestedAllocationHandler } from './suggestedAllocationService';

// ---------------------------------------------------------------------------
// Deep-freeze + structural-snapshot helpers (pure-layer mutation guard)
// ---------------------------------------------------------------------------

/**
 * Recursively `Object.freeze` a value (objects, arrays, and Map values), so any
 * attempted in-place mutation throws in strict mode. Primitives and already
 * frozen values are returned unchanged. Map key/value entries are frozen but the
 * Map wrapper is still frozen too; the pure functions only read it.
 */
function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        if (value instanceof Map) {
            for (const entry of value.values()) {
                deepFreeze(entry);
            }
            return Object.freeze(value);
        }
        for (const key of Object.keys(value as Record<string, unknown>)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
    }
    return value;
}

/**
 * Assert that calling `fn` with the supplied `inputs` never throws and leaves
 * each input structurally unchanged. Each input is deep-cloned before the call
 * (the comparison baseline) and recursively frozen (the in-place-write guard).
 */
function assertDoesNotMutate(inputs: readonly unknown[], fn: () => void): void {
    const before = inputs.map((input) => structuredClone(input));
    for (const input of inputs) {
        deepFreeze(input);
    }
    expect(fn).not.toThrow();
    inputs.forEach((input, index) => {
        expect(input).toEqual(before[index]);
    });
}

// ---------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------

// Small shared pools so questionIds / referenceKeys actually overlap and the
// functions exercise their resolution / matching paths.
const REFERENCE_KEYS = ['rk-0', 'rk-1', 'rk-2', 'rk-3'];
const QUESTION_IDS = ['q-0', 'q-1', 'q-2', 'q-3'];

const referenceKeyArb = fc.constantFrom(...REFERENCE_KEYS);
const questionIdArb = fc.constantFrom(...QUESTION_IDS);
const statusArb: fc.Arbitrary<ChapterStatus> = fc.constantFrom(
    'NOT_STARTED',
    'IN_PROGRESS',
    'DONE',
    'REVISED',
);
const nonNegArb = fc.double({ min: 0, max: 100, noNaN: true });
const shareArb = fc.double({ min: 0, max: 1, noNaN: true });
const weightageArb = fc.oneof(fc.constant(null), fc.double({ min: 0, max: 50, noNaN: true }));

const allocationChapterArb: fc.Arbitrary<AllocationChapter> = fc.record({
    id: fc.uuid(),
    referenceKey: referenceKeyArb,
    status: statusArb,
    weightage: weightageArb,
    weightageIsDefault: fc.boolean(),
});

const outcomeArb: fc.Arbitrary<AttemptQuestionOutcome> = fc.record({
    questionId: questionIdArb,
});

const linkArb: fc.Arbitrary<QuestionTopicLink> = fc.record({
    questionId: questionIdArb,
    topicKey: referenceKeyArb,
});

const frequencyRecordArb: fc.Arbitrary<TopicFrequencyRecord> = fc.record({
    topicKey: referenceKeyArb,
    avgQuestionsPerYear: nonNegArb,
});

const signalInputArb: fc.Arbitrary<ChapterSignalInput> = fc.record({
    chapterId: fc.uuid(),
    referenceKey: referenceKeyArb,
    pyqFrequency: nonNegArb,
    historicalFrequency: nonNegArb,
    hasHistoricalData: fc.boolean(),
});

const chapterSignalArb: fc.Arbitrary<ChapterSignal> = fc.record({
    chapterId: fc.uuid(),
    referenceKey: referenceKeyArb,
    pyqFrequency: nonNegArb,
    historicalFrequency: nonNegArb,
    hasHistoricalData: fc.boolean(),
    rawSignal: nonNegArb,
    combinedWeightageSignal: shareArb,
});

const suggestedInputArb: fc.Arbitrary<SuggestedChapterInput> = fc.record({
    chapterId: fc.uuid(),
    referenceKey: referenceKeyArb,
    pyqFrequency: nonNegArb,
    historicalFrequency: nonNegArb,
    hasHistoricalData: fc.boolean(),
    rawSignal: nonNegArb,
    combinedWeightageSignal: shareArb,
    status: statusArb,
    weightage: weightageArb,
    weightageIsDefault: fc.boolean(),
    timeAllocationOverride: fc.option(shareArb, { nil: null }),
});

const allocatorChapterArb: fc.Arbitrary<AllocatorChapterLike> = fc.record({
    id: fc.uuid(),
    status: statusArb,
    weightage: weightageArb,
});

const modeArb: fc.Arbitrary<EffectiveAllocationMode | null> = fc.constantFrom(
    'SUGGESTED',
    'PHASE1_DEFAULT',
    null,
);

/** A timetable-basis scenario whose snapshot shares key off the scenario's own chapters. */
const basisScenarioArb = fc
    .array(allocatorChapterArb, { maxLength: 8 })
    .chain((chapters) =>
        fc.record({
            chapters: fc.constant(chapters),
            mode: modeArb,
            shareEntries: fc.array(
                fc.tuple(
                    chapters.length > 0
                        ? fc.constantFrom(...chapters.map((chapter) => chapter.id))
                        : fc.uuid(),
                    shareArb,
                ),
                { maxLength: 8 },
            ),
        }),
    );

// ---------------------------------------------------------------------------
// Property 12 — pure layer
// ---------------------------------------------------------------------------

describe('Allocation pure computations never mutate their inputs (Property 12)', () => {
    // Feature: weightage-based-time-allocation, Property 12: Computations never mutate existing records
    it('Property 12: pure frequency/signal/ranking/allocation/basis functions leave deep-frozen inputs unchanged (Req 1.6, 2.5, 7.5, 8.3, 9.4)', () => {
        fc.assert(
            fc.property(
                fc.array(outcomeArb, { maxLength: 8 }),
                fc.array(linkArb, { maxLength: 8 }),
                fc.array(allocationChapterArb, { maxLength: 6 }),
                fc.array(frequencyRecordArb, { maxLength: 6 }),
                fc.array(signalInputArb, { maxLength: 6 }),
                fc.array(chapterSignalArb, { maxLength: 6 }),
                fc.array(suggestedInputArb, { maxLength: 6 }),
                basisScenarioArb,
                (
                    outcomes,
                    links,
                    chapters,
                    frequencyRecords,
                    signalInputs,
                    chapterSignals,
                    suggestedInputs,
                    basis,
                ) => {
                    // pyqChapterFrequency(outcomes, links, chapters) — Req 1.6
                    assertDoesNotMutate([outcomes, links, chapters], () => {
                        pyqChapterFrequency(outcomes, links, chapters);
                    });

                    // historicalChapterFrequency(chapters2, records) — Req 2.5
                    const chapters2 = structuredClone(chapters);
                    assertDoesNotMutate([chapters2, frequencyRecords], () => {
                        historicalChapterFrequency(chapters2, frequencyRecords);
                    });

                    // combinedWeightageSignal(inputs) — Req 9.4
                    assertDoesNotMutate([signalInputs], () => {
                        combinedWeightageSignal(signalInputs);
                    });

                    // mostFrequentChapters(signals) — Req 9.4
                    assertDoesNotMutate([chapterSignals], () => {
                        mostFrequentChapters(chapterSignals);
                    });

                    // suggestedTimeAllocation(inputs) — Req 8.3, 9.4
                    assertDoesNotMutate([suggestedInputs], () => {
                        suggestedTimeAllocation(suggestedInputs);
                    });

                    // resolveTimetableBasis(chapters, mode, snapshotShares) — Req 7.5
                    const snapshotShares = new Map<string, number>(basis.shareEntries);
                    assertDoesNotMutate([basis.chapters, snapshotShares], () => {
                        resolveTimetableBasis(basis.chapters, basis.mode, snapshotShares);
                    });
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ---------------------------------------------------------------------------
// Property 12 — service layer
// ---------------------------------------------------------------------------

type AllocationHandler = (request: Request, ctx: AuthContext) => Promise<Response>;

const READ_HANDLERS: ReadonlyArray<{ name: string; handler: AllocationHandler; path: string }> = [
    { name: 'signal', handler: signalHandler, path: '/api/allocation/signal' },
    {
        name: 'most-frequent-chapters',
        handler: mostFrequentChaptersHandler,
        path: '/api/allocation/most-frequent-chapters',
    },
    {
        name: 'suggested-allocation',
        handler: suggestedAllocationHandler,
        path: '/api/allocation/suggested-allocation',
    },
];

/** Existing models that must never be written by the read handlers (Req 9.4). */
const EXISTING_MODELS = [
    'profile',
    'chapter',
    'pYQAttempt',
    'questionTopicMap',
    'topicFrequencyReferenceData',
] as const;

const WRITE_METHODS = [
    'create',
    'createMany',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
] as const;

function authCtx(userId: string): AuthContext {
    return {
        user: { id: userId } as AuthContext['user'],
        session: {} as AuthContext['session'],
    };
}

function getReq(path: string): Request {
    return new Request(`http://localhost${path}`, { method: 'GET' });
}

/** Reset every Prisma spy and the resolver between iterations. */
function resetAll(): void {
    for (const model of Object.values(prismaMock)) {
        for (const method of Object.values(model)) {
            (method as ReturnType<typeof vi.fn>).mockReset();
        }
    }
    resolveActiveReferenceYearMock.mockReset();
}

const chapterRowArb = fc.record({
    id: fc.uuid(),
    referenceKey: referenceKeyArb,
    status: statusArb,
    weightage: weightageArb,
    weightageIsDefault: fc.boolean(),
    weightageOverride: weightageArb,
    timeAllocationOverride: fc.option(shareArb, { nil: null }),
});

const attemptRowArb = fc.record({
    perQuestion: fc.array(fc.record({ questionId: questionIdArb }), { maxLength: 6 }),
});

const linkRowArb = fc.record({ questionId: questionIdArb, topicKey: referenceKeyArb });
const freqRowArb = fc.record({ topicKey: referenceKeyArb, avgQuestionsPerYear: nonNegArb });

describe('Allocation read handlers only write SuggestedAllocationSnapshot (Property 12)', () => {
    beforeEach(() => {
        resetAll();
    });

    // Feature: weightage-based-time-allocation, Property 12: Computations never mutate existing records
    it('Property 12: across all read handlers, no existing model is created/updated/deleted; only snapshot.upsert may write (Req 9.4, 1.6, 2.5, 8.3)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom('JEE', 'NEET'),
                fc.constantFrom('FREE', 'PAID'),
                fc.constantFrom('EN', 'HI'),
                fc.uuid(),
                fc.integer({ min: 2000, max: 2100 }),
                fc.array(chapterRowArb, { maxLength: 8 }),
                fc.array(attemptRowArb, { maxLength: 5 }),
                fc.array(linkRowArb, { maxLength: 8 }),
                fc.array(freqRowArb, { maxLength: 8 }),
                async (
                    examTrack,
                    subscriptionTier,
                    language,
                    userId,
                    referenceDataYear,
                    chapterRows,
                    attemptRows,
                    linkRows,
                    freqRows,
                ) => {
                    resetAll();

                    // User is onboarded and the topic-frequency dataset is present, so each
                    // handler runs its full read + compute pipeline.
                    prismaMock.profile.findUnique.mockResolvedValue({
                        examTrack,
                        language,
                        subscriptionTier,
                    });
                    resolveActiveReferenceYearMock.mockResolvedValue(referenceDataYear);
                    prismaMock.chapter.findMany.mockResolvedValue(chapterRows);
                    prismaMock.pYQAttempt.findMany.mockResolvedValue(attemptRows);
                    prismaMock.questionTopicMap.findMany.mockResolvedValue(linkRows);
                    prismaMock.topicFrequencyReferenceData.findMany.mockResolvedValue(freqRows);
                    prismaMock.suggestedAllocationSnapshot.upsert.mockResolvedValue({});

                    for (const { handler, path } of READ_HANDLERS) {
                        const response = await handler(getReq(path), authCtx(userId));
                        // The handler completed its full computation (so the no-mutation
                        // assertion below is meaningful, not short-circuited).
                        expect(response.status).toBe(200);
                    }

                    // No existing Phase 1 / Performance Analytics row is created, updated, or
                    // deleted by any read handler (Req 9.4).
                    for (const model of EXISTING_MODELS) {
                        for (const method of WRITE_METHODS) {
                            expect(prismaMock[model][method]).not.toHaveBeenCalled();
                        }
                    }

                    // The ONLY write reached is suggestedAllocationSnapshot.upsert (the new
                    // Phase 2 model); no other snapshot write method fires.
                    for (const method of WRITE_METHODS) {
                        if (method === 'upsert') {
                            continue;
                        }
                        expect(
                            prismaMock.suggestedAllocationSnapshot[method],
                        ).not.toHaveBeenCalled();
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});
