import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { toChapterCreateInputs } from './validation';
import { EXAM_TRACKS, getChapters, getSubjects } from '@/lib/reference';

/**
 * Property test for the exam-track subject and reference load (task 4.3, Property 5).
 *
 * Exercises the reference catalog (`getSubjects` / `getChapters`) together with the
 * onboarding mapper `toChapterCreateInputs`, which is the exact path the onboarding
 * service uses to instantiate a user's per-track `Chapter` set. No database is touched —
 * the catalog and mapper are pure.
 *
 * Validates: Requirements 2.4, 2.7, 12.6
 */
describe('Property 5: Exam-track subject and reference load', () => {
    // Feature: jee-neet-study-app, Property 5: For any exam track selected at onboarding, the user's associated subjects equal that track's canonical subject set, and every loaded chapter starts with status NOT_STARTED and carries both a weightage value and an estimated-study-hours value.
    it('loads the canonical subject set and NOT_STARTED chapters with weightage + estimated hours', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...EXAM_TRACKS),
                fc.string({ minLength: 1, maxLength: 40 }),
                (track, userId) => {
                    const inputs = toChapterCreateInputs(track, userId);

                    // The set of subjects the loaded chapters associate to equals the
                    // track's canonical subject set (Req 2.4).
                    const canonicalSubjectKeys = new Set(getSubjects(track).map((s) => s.key));
                    const associatedSubjectKeys = new Set(inputs.map((c) => c.subjectId));
                    expect(associatedSubjectKeys).toEqual(canonicalSubjectKeys);

                    // One per-user chapter is loaded for every catalog chapter (Req 2.7).
                    expect(inputs).toHaveLength(getChapters(track).length);

                    // Every loaded chapter starts NOT_STARTED and carries a weightage value
                    // and an estimated-study-hours value (Req 2.7, 12.6).
                    for (const chapter of inputs) {
                        expect(chapter.userId).toBe(userId);
                        expect(chapter.status).toBe('NOT_STARTED');
                        expect(typeof chapter.weightage).toBe('number');
                        expect(chapter.weightage).toBeGreaterThan(0);
                        expect(typeof chapter.estimatedStudyHours).toBe('number');
                        expect(chapter.estimatedStudyHours).toBeGreaterThan(0);
                    }
                },
            ),
        );
    });
});
