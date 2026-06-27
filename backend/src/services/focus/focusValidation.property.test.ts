/**
 * Property-based tests for the pure focus-session validation logic.
 *
 *   - Property 21 (task 8.3): focus-session duration validity (Req 4.5).
 *   - Property 22 (task 8.4): session-type default (Req 4.7, 4.8).
 *
 * Each property is a single fast-check assertion running the global >= 100 iterations
 * (configured in vitest.setup.ts), placed next to the {@link validateFocusSessionInput} /
 * {@link resolveSessionType} logic it validates.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SESSION_TYPE,
    elapsedWallClockMinutes,
    resolveSessionType,
    SESSION_TYPES,
    validateFocusSessionInput,
} from './focusValidation';

const MS_PER_MIN = 60_000;

describe('focusValidation properties', () => {
    // Feature: jee-neet-study-app, Property 21: For any submitted focus session, it is
    // recorded only if its focused duration is greater than zero and not greater than the
    // wall-clock span between start and end; otherwise it is rejected.
    it('Property 21: focus-session duration validity (Req 4.5)', () => {
        fc.assert(
            fc.property(
                // a guaranteed non-blank subject id
                fc.string({ minLength: 1 }).map((s) => `subj-${s}`),
                // start instant
                fc.date({
                    min: new Date('2024-01-01T00:00:00.000Z'),
                    max: new Date('2030-01-01T00:00:00.000Z'),
                }),
                // wall-clock span in whole minutes (may be negative => end precedes start)
                fc.integer({ min: -120, max: 600 }),
                // candidate focused duration in minutes (spans <=0, boundary, and over-span)
                fc.integer({ min: -20, max: 700 }),
                (subjectId, startTime, gapMin, durMin) => {
                    const endTime = new Date(startTime.getTime() + gapMin * MS_PER_MIN);
                    const elapsed = elapsedWallClockMinutes(startTime, endTime);
                    // exact: gap is whole minutes => elapsed === gapMin
                    expect(elapsed).toBe(gapMin);

                    const result = validateFocusSessionInput({
                        subjectId,
                        startTime: startTime.toISOString(),
                        endTime: endTime.toISOString(),
                        focusedDurationMin: durMin,
                    });

                    const expectedOk = durMin > 0 && durMin <= elapsed;
                    expect(result.ok).toBe(expectedOk);
                    if (result.ok) {
                        expect(result.value.focusedDurationMin).toBe(durMin);
                    }
                },
            ),
        );
    });

    // Feature: jee-neet-study-app, Property 22: For any recorded focus session, the persisted
    // session type equals the provided type, or NEW_CHAPTER when no type was provided.
    it('Property 22: session-type default (Req 4.7, 4.8)', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.record({
                        kind: fc.constant('provided' as const),
                        value: fc.constantFrom(...SESSION_TYPES),
                    }),
                    fc.record({
                        kind: fc.constant('omitted' as const),
                        value: fc.constantFrom(undefined, null, ''),
                    }),
                ),
                (provided) => {
                    const result = resolveSessionType(provided.value);
                    expect(result.ok).toBe(true);
                    if (result.ok) {
                        const expected =
                            provided.kind === 'provided' ? provided.value : DEFAULT_SESSION_TYPE;
                        expect(result.sessionType).toBe(expected);
                    }
                },
            ),
        );
    });
});
