/**
 * Property-based test for the pure actual-study-time derivation.
 *
 *   - Property 27 (task 10.3): daily-audit actual-time derivation (Req 14.1, 14.2, 14.3).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the {@link resolveActualMin} logic it validates.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { resolveActualMin, type AuditFocusSession } from './resolveActualMin';

describe('resolveActualMin properties', () => {
    // Feature: jee-neet-study-app, Property 27: For any daily check-in, the recorded actual
    // study time equals the sum of that day's focused durations when focus-session data exists,
    // and equals the user-entered value otherwise.
    it('Property 27: daily-audit actual-time derivation (Req 14.1, 14.2, 14.3)', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({ focusedDurationMin: fc.integer({ min: 0, max: 600 }) }),
                    { maxLength: 30 },
                ),
                fc.oneof(fc.integer({ min: 0, max: 1440 }), fc.constant(null), fc.constant(undefined)),
                (daySessions: AuditFocusSession[], userEnteredActual) => {
                    const result = resolveActualMin(daySessions, userEnteredActual);

                    if (daySessions.length > 0) {
                        const expected = daySessions.reduce(
                            (sum, s) => sum + s.focusedDurationMin,
                            0,
                        );
                        expect(result).toBe(expected);
                    } else {
                        expect(result).toBe(userEnteredActual ?? 0);
                    }
                },
            ),
        );
    });
});
