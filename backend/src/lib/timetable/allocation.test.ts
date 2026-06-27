/**
 * Unit (example) tests for STEPS 3–5 of the timetable pipeline — buffer reservation,
 * weightage-aware allocation, and efficiency auto-scaling (Req 11.1, 11.2, 11.3, 11.4, 11.5,
 * 12.3, 14.5, 15.1). DB- and framework-independent.
 *
 * The numbered Correctness Properties 12/13/14/17/29 (tasks 6.13/6.14/6.15/6.18/6.22) are
 * implemented separately as fast-check property tests; these are example/edge-case tests.
 */
import { describe, expect, it } from 'vitest';

import {
    BUFFER_MAX_FRACTION,
    BUFFER_MIN_FRACTION,
    BUFFER_TARGET_FRACTION,
    allocateStudyHours,
    isPendingStatus,
    reserveBuffer,
    type AllocatorChapter,
    type ChapterStatus,
} from './allocation';

/** Build an allocator chapter with sensible defaults. */
function chapter(overrides: Partial<AllocatorChapter> & { id: string }): AllocatorChapter {
    return {
        subjectId: 'subjectA',
        status: 'NOT_STARTED',
        weightage: 10,
        estimatedStudyHours: 100,
        ...overrides,
    };
}

const SUM = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('reserveBuffer (STEP 3, Req 15.1)', () => {
    it('reserves the 12.5% target by default and A = W - B', () => {
        const r = reserveBuffer(40);
        expect(r.bufferFraction).toBe(BUFFER_TARGET_FRACTION);
        expect(r.bufferHours).toBeCloseTo(5, 10); // 12.5% of 40
        expect(r.assignableHours).toBeCloseTo(35, 10);
        expect(r.bufferHours + r.assignableHours).toBeCloseTo(40, 10);
    });

    it('keeps the buffer fraction within [10%, 15%] of W for the default and clamped inputs', () => {
        for (const w of [0, 1, 6, 42, 100.5]) {
            const r = reserveBuffer(w);
            if (w > 0) {
                const frac = r.bufferHours / w;
                expect(frac).toBeGreaterThanOrEqual(BUFFER_MIN_FRACTION - 1e-9);
                expect(frac).toBeLessThanOrEqual(BUFFER_MAX_FRACTION + 1e-9);
            }
        }
    });

    it('clamps an out-of-band requested fraction into [10%, 15%]', () => {
        expect(reserveBuffer(100, 0.5).bufferFraction).toBe(BUFFER_MAX_FRACTION);
        expect(reserveBuffer(100, 0.0).bufferFraction).toBe(BUFFER_MIN_FRACTION);
        expect(reserveBuffer(100, 0.13).bufferFraction).toBe(0.13);
    });

    it('treats a non-positive budget as zero buffer and zero assignable', () => {
        const r = reserveBuffer(-5);
        expect(r.bufferHours).toBe(0);
        expect(r.assignableHours).toBe(0);
        expect(r.weeklyBudgetHours).toBe(0);
    });
});

describe('isPendingStatus (Req 12.3)', () => {
    it('only NOT_STARTED and IN_PROGRESS are pending', () => {
        const expected: Record<ChapterStatus, boolean> = {
            NOT_STARTED: true,
            IN_PROGRESS: true,
            DONE: false,
            REVISED: false,
        };
        for (const [status, want] of Object.entries(expected)) {
            expect(isPendingStatus(status as ChapterStatus)).toBe(want);
        }
    });
});

describe('allocateStudyHours — pending filter (Req 12.3)', () => {
    it('allocates only to pending chapters; DONE/REVISED are excluded', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'a', status: 'NOT_STARTED' }),
            chapter({ id: 'b', status: 'IN_PROGRESS' }),
            chapter({ id: 'c', status: 'DONE' }),
            chapter({ id: 'd', status: 'REVISED' }),
        ];
        const result = allocateStudyHours(chapters, 40);
        const ids = result.allocations.map((x) => x.chapterId).sort();
        expect(ids).toEqual(['a', 'b']);
    });

    it('returns no allocations when there are no pending chapters', () => {
        const chapters: AllocatorChapter[] = [chapter({ id: 'c', status: 'DONE' })];
        const result = allocateStudyHours(chapters, 40);
        expect(result.allocations).toHaveLength(0);
        // Buffer is still reserved from W.
        expect(result.bufferHours).toBeCloseTo(5, 10);
        expect(result.assignableHours).toBeCloseTo(35, 10);
    });
});

describe('allocateStudyHours — proportional, not equal (Req 11.1, 11.2)', () => {
    it('distributes assignable hours proportional to weightage (default, not equal)', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'a', weightage: 30, estimatedStudyHours: 1000 }),
            chapter({ id: 'b', weightage: 10, estimatedStudyHours: 1000 }),
        ];
        const result = allocateStudyHours(chapters, 40); // A = 35
        const a = result.allocations.find((x) => x.chapterId === 'a')!;
        const b = result.allocations.find((x) => x.chapterId === 'b')!;
        // 30:10 => 3:1 split of A = 35
        expect(a.allocatedHours).toBeCloseTo(26.25, 9);
        expect(b.allocatedHours).toBeCloseTo(8.75, 9);
        // Not an equal split.
        expect(a.allocatedHours).not.toBeCloseTo(b.allocatedHours, 5);
        // Sum of allocations equals assignable when uncapped.
        expect(SUM(result.allocations.map((x) => x.allocatedHours))).toBeCloseTo(35, 9);
    });

    it('is monotonic in effective weightage at equal remaining estimate', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'low', weightage: 5, estimatedStudyHours: 1000 }),
            chapter({ id: 'mid', weightage: 15, estimatedStudyHours: 1000 }),
            chapter({ id: 'high', weightage: 40, estimatedStudyHours: 1000 }),
        ];
        const result = allocateStudyHours(chapters, 80);
        const byId = Object.fromEntries(result.allocations.map((x) => [x.chapterId, x.allocatedHours]));
        expect(byId.high).toBeGreaterThan(byId.mid);
        expect(byId.mid).toBeGreaterThan(byId.low);
    });
});

describe('allocateStudyHours — override precedence (Req 11.3, 11.4)', () => {
    it('timeAllocationOverride wins over weightageOverride, weightage, and subject-mean', () => {
        const chapters: AllocatorChapter[] = [
            chapter({
                id: 'a',
                weightage: 10,
                weightageOverride: 50,
                timeAllocationOverride: 90,
            }),
            chapter({ id: 'b', weightage: 10 }),
        ];
        const result = allocateStudyHours(chapters, 1000, { bufferFraction: 0.1 });
        const a = result.allocations.find((x) => x.chapterId === 'a')!;
        expect(a.effectiveWeightage).toBe(90);
        expect(a.weightageIsDefault).toBe(false);
    });

    it('weightageOverride wins over reference weightage when no timeAllocationOverride', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'a', weightage: 10, weightageOverride: 75 }),
        ];
        const a = allocateStudyHours(chapters, 100).allocations[0];
        expect(a.effectiveWeightage).toBe(75);
        expect(a.weightageIsDefault).toBe(false);
    });

    it('reference weightage is used when no overrides are present', () => {
        const a = allocateStudyHours([chapter({ id: 'a', weightage: 42 })], 100).allocations[0];
        expect(a.effectiveWeightage).toBe(42);
        expect(a.weightageIsDefault).toBe(false);
    });
});

describe('allocateStudyHours — missing-weightage subject-mean fallback (Req 11.5)', () => {
    it('uses the subject mean and flags weightageIsDefault for a missing reference weightage', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'a', subjectId: 'phys', weightage: 20 }),
            chapter({ id: 'b', subjectId: 'phys', weightage: 40 }),
            chapter({ id: 'missing', subjectId: 'phys', weightage: null }),
        ];
        const result = allocateStudyHours(chapters, 100);
        const missing = result.allocations.find((x) => x.chapterId === 'missing')!;
        expect(missing.weightageIsDefault).toBe(true);
        // mean of {20, 40} = 30
        expect(missing.effectiveWeightage).toBe(30);
    });

    it('falls back to the global mean when the subject has no defined weightage', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'other', subjectId: 'chem', weightage: 60 }),
            chapter({ id: 'missing', subjectId: 'phys', weightage: null }),
        ];
        const missing = allocateStudyHours(chapters, 100).allocations.find(
            (x) => x.chapterId === 'missing',
        )!;
        expect(missing.weightageIsDefault).toBe(true);
        expect(missing.effectiveWeightage).toBe(60); // global mean of {60}
    });

    it('degenerates to an equal split (weight 1) when no chapter anywhere has a weightage', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'a', weightage: null, estimatedStudyHours: 1000 }),
            chapter({ id: 'b', weightage: null, estimatedStudyHours: 1000 }),
        ];
        const result = allocateStudyHours(chapters, 40); // A = 35
        const a = result.allocations.find((x) => x.chapterId === 'a')!;
        const b = result.allocations.find((x) => x.chapterId === 'b')!;
        expect(a.effectiveWeightage).toBe(1);
        expect(b.effectiveWeightage).toBe(1);
        expect(a.weightageIsDefault).toBe(true);
        expect(a.allocatedHours).toBeCloseTo(17.5, 9);
        expect(b.allocatedHours).toBeCloseTo(17.5, 9);
    });
});

describe('allocateStudyHours — capping by remaining estimate + redistribution', () => {
    it('caps a chapter at its remaining estimate and redistributes surplus to uncapped chapters', () => {
        const chapters: AllocatorChapter[] = [
            // High weightage but a tiny estimate: it should be capped at 2h.
            chapter({ id: 'small', weightage: 90, estimatedStudyHours: 2 }),
            chapter({ id: 'big', weightage: 10, estimatedStudyHours: 1000 }),
        ];
        const result = allocateStudyHours(chapters, 40, { bufferFraction: 0.1 }); // A = 36
        const small = result.allocations.find((x) => x.chapterId === 'small')!;
        const big = result.allocations.find((x) => x.chapterId === 'big')!;
        // small is capped at its estimate.
        expect(small.allocatedHours).toBeCloseTo(2, 9);
        // The surplus flows to big; nothing exceeds its own estimate.
        expect(big.allocatedHours).toBeCloseTo(34, 9);
        expect(big.allocatedHours).toBeLessThanOrEqual(big.remainingEstimateHours + 1e-9);
    });

    it('honors estHoursOverride as the cap over estimatedStudyHours', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'a', weightage: 50, estimatedStudyHours: 1000, estHoursOverride: 3 }),
            chapter({ id: 'b', weightage: 50, estimatedStudyHours: 1000 }),
        ];
        const result = allocateStudyHours(chapters, 40, { bufferFraction: 0.1 }); // A = 36
        const a = result.allocations.find((x) => x.chapterId === 'a')!;
        expect(a.allocatedHours).toBeCloseTo(3, 9);
    });

    it('never allocates a chapter more than its remaining estimate', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'a', weightage: 50, estimatedStudyHours: 5 }),
            chapter({ id: 'b', weightage: 50, estimatedStudyHours: 5 }),
        ];
        // Assignable far exceeds total estimate (10h); allocations are capped, surplus unallocated.
        const result = allocateStudyHours(chapters, 1000);
        for (const a of result.allocations) {
            expect(a.allocatedHours).toBeLessThanOrEqual(a.remainingEstimateHours + 1e-9);
        }
        expect(SUM(result.allocations.map((x) => x.allocatedHours))).toBeCloseTo(10, 6);
    });
});

describe('allocateStudyHours — efficiency auto-scaling (STEP 5, Req 14.5)', () => {
    it('scales allocations down by efficiencyScore when below 1, never exceeding the unscaled value', () => {
        const chapters: AllocatorChapter[] = [
            chapter({ id: 'a', weightage: 30, estimatedStudyHours: 1000 }),
            chapter({ id: 'b', weightage: 10, estimatedStudyHours: 1000 }),
        ];
        const result = allocateStudyHours(chapters, 40, { efficiencyScore: 0.5 });
        for (const a of result.allocations) {
            expect(a.allocatedHours).toBeCloseTo(a.unscaledHours * 0.5, 9);
            expect(a.allocatedHours).toBeLessThanOrEqual(a.unscaledHours + 1e-9);
        }
        expect(result.efficiencyScore).toBe(0.5);
    });

    it('leaves allocations unchanged when efficiencyScore >= 1', () => {
        const chapters: AllocatorChapter[] = [chapter({ id: 'a', weightage: 10, estimatedStudyHours: 1000 })];
        for (const score of [1, 1.5, 3]) {
            const a = allocateStudyHours(chapters, 40, { efficiencyScore: score }).allocations[0];
            expect(a.allocatedHours).toBeCloseTo(a.unscaledHours, 9);
        }
    });

    it('treats a negative efficiency score as zero', () => {
        const a = allocateStudyHours([chapter({ id: 'a' })], 40, { efficiencyScore: -2 }).allocations[0];
        expect(a.allocatedHours).toBe(0);
    });
});
