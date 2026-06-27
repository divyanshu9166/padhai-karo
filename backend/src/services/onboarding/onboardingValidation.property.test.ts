import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { validateOnboardingInput } from './validation';

/**
 * Property test for the onboarding validation boundaries (task 4.4, Property 6).
 *
 * Drives the pure `validateOnboardingInput` across the two rejection boundaries from
 * Req 2.2 (target year earlier than the current calendar year) and Req 2.3 (any fixed
 * commitment whose end time is not later than its start time). The "current year" is
 * injected so the boundary is deterministic.
 *
 * Validates: Requirements 2.2, 2.3
 */

/** Format minutes-since-midnight (0–1439) as a 24-hour "HH:mm" string. */
function toHHmm(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const currentYearArb = fc.integer({ min: 2000, max: 2100 });

/** A payload that is well-formed except for the boundary under test. */
function basePayload(): Record<string, unknown> {
    return {
        examTrack: 'JEE',
        currentClass: 'Class 12',
        fixedCommitments: [{ dayOfWeek: 1, startTime: '08:00', endTime: '14:00', label: 'School' }],
        peakFocusWindows: [],
    };
}

describe('Property 6: Onboarding validation boundaries', () => {
    // Feature: jee-neet-study-app, Property 6: For any onboarding payload, a target year earlier than the current calendar year is rejected, and any fixed commitment whose end time is not later than its start time is rejected with a validation error.
    it('rejects an earlier target year and any commitment whose end is not later than its start', () => {
        // Scenario A — target year earlier than the current calendar year (Req 2.2).
        const earlierYearScenario = currentYearArb.chain((currentYear) =>
            fc
                .integer({ min: 1, max: 50 })
                .map((delta) => ({
                    currentYear,
                    payload: { ...basePayload(), targetYear: currentYear - delta },
                })),
        );

        // Scenario B — a fixed commitment with end <= start (Req 2.3). `start` and `end`
        // are generated so that `end` never exceeds `start`.
        const badCommitmentScenario = currentYearArb.chain((currentYear) =>
            fc
                .integer({ min: 0, max: 1439 })
                .chain((start) =>
                    fc.integer({ min: 0, max: start }).map((end) => ({
                        currentYear,
                        payload: {
                            ...basePayload(),
                            targetYear: currentYear, // valid year so only the commitment is at fault
                            fixedCommitments: [
                                {
                                    dayOfWeek: 1,
                                    startTime: toHHmm(start),
                                    endTime: toHHmm(end),
                                    label: 'School',
                                },
                            ],
                        },
                    })),
                ),
        );

        fc.assert(
            fc.property(
                fc.oneof(earlierYearScenario, badCommitmentScenario),
                ({ payload, currentYear }) => {
                    const result = validateOnboardingInput(payload, currentYear);
                    expect(result.ok).toBe(false);
                    if (!result.ok) {
                        expect(result.code).toBe('VALIDATION_ERROR');
                    }
                },
            ),
        );
    });
});
