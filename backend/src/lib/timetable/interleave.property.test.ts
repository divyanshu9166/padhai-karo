/**
 * Property-based test for STEP 8 — subject interleaving / anti-block scheduling
 * (`./interleave`).
 *
 *   - Property 16 (task 6.17): interleaving bound (Req 17.1, 17.4).
 *
 * A single fast-check assertion running the global >= 100 iterations (vitest.setup.ts),
 * placed next to {@link interleaveBlocks}. The arranger keeps no subject running longer than
 * the 2-hour bound while two or more subjects still have work, and applies no constraint when
 * only a single subject is present (Req 17.4). To stay within the documented guarantee — a
 * lone trailing subject left after all others are exhausted may run long — multi-subject
 * cases are constrained so no subject's total dwarfs the others (which is the realistic shape
 * of weightage-balanced allocations the generator feeds in).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    MAX_CONSECUTIVE_SUBJECT_MINUTES,
    distinctSubjectCount,
    interleaveBlocks,
    maxConsecutiveSubjectMinutes,
    violatesInterleaving,
    type InterleaveUnit,
} from './interleave';

const SUBJECT_POOL = ['Physics', 'Chemistry', 'Mathematics'] as const;

describe('Property 16: Interleaving bound', () => {
    // Feature: jee-neet-study-app, Property 16: For any generated timetable in which more than one subject has pending chapters, no single subject is scheduled for more than 2 consecutive hours without an intervening block of a different subject; when only one subject has pending chapters, generation succeeds without applying the constraint.
    it('keeps multi-subject runs within 120 minutes and leaves a single subject unconstrained (Req 17.1, 17.4)', () => {
        fc.assert(
            fc.property(
                // Per-subject block counts; each block is a uniform 60-minute unit (≤ the bound).
                fc.record({
                    Physics: fc.integer({ min: 0, max: 6 }),
                    Chemistry: fc.integer({ min: 0, max: 6 }),
                    Mathematics: fc.integer({ min: 0, max: 6 }),
                }),
                (counts) => {
                    const units: InterleaveUnit[] = [];
                    for (const subjectId of SUBJECT_POOL) {
                        for (let i = 0; i < counts[subjectId]; i += 1) {
                            units.push({ subjectId, durationMinutes: 60 });
                        }
                    }

                    const distinct = distinctSubjectCount(units);
                    const minutesBySubject = SUBJECT_POOL.map((s) => counts[s] * 60);
                    const maxMinutes = Math.max(0, ...minutesBySubject);
                    const otherMinutes =
                        minutesBySubject.reduce((sum, m) => sum + m, 0) - maxMinutes;

                    // Only assert the bound on balanced multi-subject inputs: when one subject's
                    // total exceeds everything else by more than the bound, a long trailing run
                    // is unavoidable (the documented single-subject-tail exception).
                    if (distinct > 1) {
                        fc.pre(maxMinutes <= otherMinutes + MAX_CONSECUTIVE_SUBJECT_MINUTES);
                    }

                    const result = interleaveBlocks(units, {
                        subjectPriority: [...SUBJECT_POOL],
                    });

                    // Reordering preserves every block: same count overall and per subject.
                    expect(result).toHaveLength(units.length);
                    for (const subjectId of SUBJECT_POOL) {
                        expect(result.filter((u) => u.subjectId === subjectId)).toHaveLength(
                            counts[subjectId],
                        );
                    }

                    if (distinct <= 1) {
                        // Single subject (or empty): the constraint is skipped and order kept.
                        expect(result.map((u) => u.subjectId)).toEqual(
                            units.map((u) => u.subjectId),
                        );
                        expect(violatesInterleaving(result)).toBe(false);
                    } else {
                        // More than one subject: no run exceeds the 2-hour bound (Req 17.1).
                        expect(maxConsecutiveSubjectMinutes(result)).toBeLessThanOrEqual(
                            MAX_CONSECUTIVE_SUBJECT_MINUTES,
                        );
                        expect(violatesInterleaving(result)).toBe(false);
                    }
                },
            ),
        );
    });
});
