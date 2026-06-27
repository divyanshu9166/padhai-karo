import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
    applyExamDateChange,
    computeCountdownDays,
    computeTargetCompletionDate,
    type ProfileExamInput,
} from './examDate';

/**
 * Property-based test for exam-date change propagation (task 17.5).
 *
 * Exercises the pure {@link applyExamDateChange} recomputation directly — no DB/clock side
 * effects. For each affected profile the target exam date is set to the new date and the
 * completion date / countdown are recomputed by the production formulas. See design
 * "Correctness Properties" → Property 46.
 *
 * Validates: Requirements 20.6
 */

const MIN_MS = Date.UTC(2024, 0, 1);
const MAX_MS = Date.UTC(2028, 0, 1);
const dateArb = fc.integer({ min: MIN_MS, max: MAX_MS }).map((ms) => new Date(ms));

const profileArb: fc.Arbitrary<ProfileExamInput> = fc.record({
    userId: fc.string({ minLength: 1, maxLength: 8 }),
    revisionBufferDays: fc.integer({ min: 0, max: 120 }),
});

describe('Property 46: Exam-date change propagation', () => {
    // Feature: jee-neet-study-app, Property 46: For any ingested announcement that changes the relevant exam date for a user's track, the user's target exam date is updated and the target completion date and countdown are recomputed accordingly.
    it('updates each affected profile\'s exam date and recomputes completion date and countdown', () => {
        fc.assert(
            fc.property(
                fc.array(profileArb, { maxLength: 8 }),
                dateArb,
                dateArb,
                (profiles, newExamDate, now) => {
                    const updates = applyExamDateChange(profiles, newExamDate, now);

                    // One update per affected profile, in order, preserving identity.
                    expect(updates).toHaveLength(profiles.length);

                    for (let i = 0; i < profiles.length; i += 1) {
                        const profile = profiles[i];
                        const update = updates[i];

                        expect(update.userId).toBe(profile.userId);

                        // Target exam date is updated to the announced date.
                        expect(update.targetExamDate.getTime()).toBe(newExamDate.getTime());

                        // Completion date and countdown are recomputed accordingly.
                        expect(update.targetCompletionDate.getTime()).toBe(
                            computeTargetCompletionDate(
                                newExamDate,
                                profile.revisionBufferDays,
                            ).getTime(),
                        );
                        expect(update.countdownDays).toBe(
                            computeCountdownDays(newExamDate, now),
                        );
                        expect(update.countdownDays).toBeGreaterThanOrEqual(0);
                    }
                },
            ),
        );
    });
});
