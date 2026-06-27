/**
 * Property-based tests for STEPS 3–5 of the timetable pipeline — buffer reservation,
 * weightage-aware allocation, and efficiency auto-scaling (`./allocation`).
 *
 * Each property is a single fast-check assertion running the global >= 100 iterations
 * (configured in vitest.setup.ts), placed next to the {@link allocateStudyHours} /
 * {@link reserveBuffer} logic it validates:
 *
 *   - Property 11 (task 6.12): only pending chapters are scheduled (Req 12.3).
 *   - Property 12 (task 6.13): weightage-proportional allocation (Req 11.1, 11.2).
 *   - Property 13 (task 6.14): overrides applied and retained (Req 11.3, 11.4).
 *   - Property 14 (task 6.15): missing-weightage subject-mean fallback (Req 11.5).
 *   - Property 17 (task 6.18): buffer reservation bound (Req 15.1).
 *   - Property 29 (task 6.22): efficiency under-scaling (Req 14.5).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    BUFFER_MAX_FRACTION,
    BUFFER_MIN_FRACTION,
    allocateStudyHours,
    isPendingStatus,
    reserveBuffer,
    type AllocatorChapter,
    type ChapterStatus,
} from './allocation';

const STATUS_POOL: readonly ChapterStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'REVISED'];
const SUBJECT_POOL = ['physics', 'chemistry', 'maths', 'biology'] as const;
const EPSILON = 1e-6;

/** An arbitrary AllocatorChapter with a unique id; status drawn from the full pool. */
function chapterArb(id: string): fc.Arbitrary<AllocatorChapter> {
    return fc.record({
        id: fc.constant(id),
        subjectId: fc.constantFrom(...SUBJECT_POOL),
        status: fc.constantFrom(...STATUS_POOL),
        weightage: fc.integer({ min: 1, max: 100 }),
        estimatedStudyHours: fc.integer({ min: 1, max: 200 }),
    });
}

/** An array of chapters with guaranteed-unique ids. */
function chaptersArb(maxLength: number): fc.Arbitrary<AllocatorChapter[]> {
    return fc
        .array(fc.integer({ min: 0, max: 3 }), { minLength: 0, maxLength })
        .chain((shape) =>
            fc.tuple(...shape.map((_, index) => chapterArb(`ch-${index}`))),
        )
        .map((chapters) => chapters as AllocatorChapter[]);
}

describe('allocation properties', () => {
    // Feature: jee-neet-study-app, Property 11: For any set of chapters, every chapter assigned to a study block has status NOT_STARTED or IN_PROGRESS.
    it('Property 11: only pending chapters are scheduled (Req 12.3)', () => {
        fc.assert(
            fc.property(chaptersArb(12), fc.integer({ min: 0, max: 300 }), (chapters, budget) => {
                const result = allocateStudyHours(chapters, budget);

                const pendingIds = chapters
                    .filter((c) => isPendingStatus(c.status))
                    .map((c) => c.id)
                    .sort();
                const allocatedIds = result.allocations.map((a) => a.chapterId).sort();

                // Exactly the pending chapters are present — no DONE/REVISED chapter is scheduled.
                expect(allocatedIds).toEqual(pendingIds);
                const statusById = new Map(chapters.map((c) => [c.id, c.status]));
                for (const allocation of result.allocations) {
                    expect(isPendingStatus(statusById.get(allocation.chapterId)!)).toBe(true);
                }
            }),
        );
    });

    // Feature: jee-neet-study-app, Property 12: For any set of pending chapters, allocated study time is monotonic in effective weightage (a higher-weightage chapter never receives less time than a lower-weightage one with equal remaining estimate), and allocation is proportional to weightage shares rather than equal across chapters.
    it('Property 12: weightage-proportional allocation (Req 11.1, 11.2)', () => {
        fc.assert(
            fc.property(
                // Distinct positive weightages so monotonicity is strict and unambiguous.
                fc.uniqueArray(fc.integer({ min: 1, max: 100 }), {
                    minLength: 2,
                    maxLength: 6,
                }),
                fc.integer({ min: 10, max: 200 }),
                (weightages, budget) => {
                    // Equal, effectively unbounded remaining estimate so nothing is capped:
                    // allocation is then a pure proportional split of the assignable hours.
                    const chapters: AllocatorChapter[] = weightages.map((weightage, index) => ({
                        id: `ch-${index}`,
                        subjectId: 'physics',
                        status: 'NOT_STARTED',
                        weightage,
                        estimatedStudyHours: 1_000_000,
                    }));

                    const result = allocateStudyHours(chapters, budget);
                    const assignable = result.assignableHours;
                    const sumWeight = weightages.reduce((s, w) => s + w, 0);

                    const allocById = new Map(
                        result.allocations.map((a) => [a.chapterId, a]),
                    );

                    // Proportional (the DEFAULT distribution, not an equal split, Req 11.2).
                    for (let i = 0; i < weightages.length; i += 1) {
                        const alloc = allocById.get(`ch-${i}`)!;
                        const expectedShare = (assignable * weightages[i]) / sumWeight;
                        expect(alloc.allocatedHours).toBeCloseTo(expectedShare, 6);
                    }

                    // Monotonic in effective weightage at equal remaining estimate (Req 11.1).
                    const sorted = [...result.allocations].sort(
                        (a, b) => a.effectiveWeightage - b.effectiveWeightage,
                    );
                    for (let i = 1; i < sorted.length; i += 1) {
                        expect(sorted[i].allocatedHours).toBeGreaterThanOrEqual(
                            sorted[i - 1].allocatedHours - EPSILON,
                        );
                    }
                },
            ),
        );
    });

    // Feature: jee-neet-study-app, Property 13: For any chapter with a time-allocation or weightage override, generation uses the override in place of the reference weightage, and the override continues to apply across repeated generations until cleared.
    it('Property 13: overrides applied and retained (Req 11.3, 11.4)', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 100 }), // reference weightage
                fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }), // weightageOverride
                fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }), // timeAllocationOverride
                fc.integer({ min: 10, max: 200 }),
                (weightage, weightageOverride, timeAllocationOverride, budget) => {
                    const chapter: AllocatorChapter = {
                        id: 'ch-0',
                        subjectId: 'physics',
                        status: 'NOT_STARTED',
                        weightage,
                        weightageOverride,
                        timeAllocationOverride,
                        estimatedStudyHours: 1_000_000,
                    };

                    const first = allocateStudyHours([chapter], budget);
                    const a = first.allocations[0];

                    // Precedence: timeAllocationOverride > weightageOverride > reference weightage.
                    const expected =
                        timeAllocationOverride ?? weightageOverride ?? weightage;
                    expect(a.effectiveWeightage).toBe(expected);
                    // An override is never the subject-mean fallback flag.
                    expect(a.weightageIsDefault).toBe(false);

                    // Retained across repeated generations: the pure allocator is deterministic,
                    // so re-running with the same (unchanged) override yields the same result.
                    const second = allocateStudyHours([chapter], budget);
                    expect(second.allocations[0].effectiveWeightage).toBe(expected);
                    expect(second.allocations[0].allocatedHours).toBeCloseTo(a.allocatedHours, 9);
                },
            ),
        );
    });

    // Feature: jee-neet-study-app, Property 14: For any chapter lacking reference weightage, it is allocated the mean weightage of its subject and flagged as using a default weightage.
    it('Property 14: missing-weightage subject-mean fallback (Req 11.5)', () => {
        fc.assert(
            fc.property(
                // The subject's chapters that DO have a defined weightage.
                fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 6 }),
                fc.integer({ min: 10, max: 200 }),
                (definedWeightages, budget) => {
                    const subjectId = 'physics';
                    const chapters: AllocatorChapter[] = definedWeightages.map((weightage, index) => ({
                        id: `def-${index}`,
                        subjectId,
                        status: 'NOT_STARTED',
                        weightage,
                        estimatedStudyHours: 1_000_000,
                    }));
                    // The chapter missing its reference weightage.
                    chapters.push({
                        id: 'missing',
                        subjectId,
                        status: 'NOT_STARTED',
                        weightage: null,
                        estimatedStudyHours: 1_000_000,
                    });

                    const result = allocateStudyHours(chapters, budget);
                    const missing = result.allocations.find((a) => a.chapterId === 'missing')!;

                    const subjectMean =
                        definedWeightages.reduce((s, w) => s + w, 0) / definedWeightages.length;

                    expect(missing.weightageIsDefault).toBe(true);
                    expect(missing.effectiveWeightage).toBeCloseTo(subjectMean, 9);
                },
            ),
        );
    });

    // Feature: jee-neet-study-app, Property 17: For any generated timetable, the total buffer time is between 10% and 15% (inclusive) of the weekly study hours, and buffer slots are assigned to no subject.
    it('Property 17: buffer reservation bound (Req 15.1)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0.1, max: 500, noNaN: true }),
                fc.double({ min: 0, max: 1, noNaN: true }),
                (weeklyBudgetHours, requestedFraction) => {
                    const reservation = reserveBuffer(weeklyBudgetHours, requestedFraction);
                    const fraction = reservation.bufferHours / weeklyBudgetHours;

                    // Always within the [10%, 15%] band regardless of the requested fraction.
                    expect(fraction).toBeGreaterThanOrEqual(BUFFER_MIN_FRACTION - EPSILON);
                    expect(fraction).toBeLessThanOrEqual(BUFFER_MAX_FRACTION + EPSILON);
                    // Buffer + assignable reconstitute the whole budget.
                    expect(reservation.bufferHours + reservation.assignableHours).toBeCloseTo(
                        weeklyBudgetHours,
                        6,
                    );

                    // allocateStudyHours reserves the same bounded buffer from W.
                    const allocResult = allocateStudyHours([], weeklyBudgetHours, {
                        bufferFraction: requestedFraction,
                    });
                    const allocFraction = allocResult.bufferHours / weeklyBudgetHours;
                    expect(allocFraction).toBeGreaterThanOrEqual(BUFFER_MIN_FRACTION - EPSILON);
                    expect(allocFraction).toBeLessThanOrEqual(BUFFER_MAX_FRACTION + EPSILON);
                },
            ),
        );
    });

    // Feature: jee-neet-study-app, Property 29: For any user with efficiency score below one, generated study-block durations are scaled toward actual completed time and never exceed the corresponding unscaled allocation.
    it('Property 29: efficiency under-scaling (Req 14.5)', () => {
        fc.assert(
            fc.property(
                chaptersArb(10),
                fc.integer({ min: 10, max: 300 }),
                fc.float({ min: 0, max: Math.fround(0.999), noNaN: true }), // efficiency < 1
                (chapters, budget, efficiencyScore) => {
                    const result = allocateStudyHours(chapters, budget, { efficiencyScore });

                    for (const allocation of result.allocations) {
                        // Scaled toward actual completed time by the (sub-one) efficiency score.
                        expect(allocation.allocatedHours).toBeCloseTo(
                            allocation.unscaledHours * efficiencyScore,
                            6,
                        );
                        // Never exceeds the unscaled allocation.
                        expect(allocation.allocatedHours).toBeLessThanOrEqual(
                            allocation.unscaledHours + EPSILON,
                        );
                    }
                },
            ),
        );
    });
});
