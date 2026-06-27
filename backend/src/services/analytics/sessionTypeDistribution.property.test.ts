/**
 * Property-based test for the pure per-Session_Type study-time distribution logic
 * (task 11.4, design "Property 15: Session-type study-time distribution").
 *
 *   - Property 15 (task 11.4): session-type study-time distribution (Req 11.3).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed next to the
 * {@link computeSessionTypeDistribution} logic it validates. Generators produce arbitrary
 * sets of focus sessions over the SESSION_TYPES with non-negative focusedDurationMin. The
 * property independently computes the per-type sums and the grand total and asserts that
 * each returned type's totalMinutes equals the expected per-type sum, that the sum of all
 * returned totalMinutes equals the grand total (conservation / no double counting), and
 * that only types that actually occur are present.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    computeSessionTypeDistribution,
    SESSION_TYPES,
    type SessionType,
    type WeakAreaFocusSessionRow,
} from './weakArea';

// Run the full validation count regardless of the lighter global default (vitest.setup.ts).
const NUM_RUNS = Math.max(100, Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10) || 0);

// A focus session over one of the five canonical Session_Types with a non-negative
// focusedDurationMin (Req 11.3 surfaces the Phase 1 Session_Type study-time data).
const arbFocusSession: fc.Arbitrary<WeakAreaFocusSessionRow> = fc.record({
    sessionType: fc.constantFrom<SessionType>(...SESSION_TYPES),
    focusedDurationMin: fc.double({ min: 0, max: 600, noNaN: true }),
});

describe('session-type study-time distribution properties', () => {
    // Feature: performance-analytics, Property 15: For any set of focus sessions, the
    // session-type distribution reports, for each session type, the exact sum of
    // focusedDurationMin of that type's sessions, conserving total minutes with no double
    // counting (the sum of all reported totals equals the grand total of all session
    // minutes), and includes only session types that actually occur.
    it('Property 15: session-type study-time distribution (Req 11.3)', () => {
        fc.assert(
            fc.property(fc.array(arbFocusSession, { maxLength: 60 }), (focusSessions) => {
                const distribution = computeSessionTypeDistribution(focusSessions);

                // Independently compute the expected per-type sums and grand total.
                const expectedByType = new Map<SessionType, number>();
                let grandTotal = 0;
                for (const session of focusSessions) {
                    expectedByType.set(
                        session.sessionType,
                        (expectedByType.get(session.sessionType) ?? 0) + session.focusedDurationMin,
                    );
                    grandTotal += session.focusedDurationMin;
                }

                // ── Only types that occur are present, exactly once each ────────────────
                const reportedTypes = distribution.map((d) => d.sessionType);
                expect(reportedTypes.length).toBe(expectedByType.size);
                expect(new Set(reportedTypes).size).toBe(reportedTypes.length);
                for (const { sessionType } of distribution) {
                    expect(expectedByType.has(sessionType)).toBe(true);
                }

                // ── Exact per-type sum (Req 11.3) ───────────────────────────────────────
                for (const { sessionType, totalMinutes } of distribution) {
                    expect(totalMinutes).toBeCloseTo(expectedByType.get(sessionType) as number, 8);
                }

                // ── Conservation / no double counting: reported totals sum to grand total
                const reportedTotal = distribution.reduce((sum, d) => sum + d.totalMinutes, 0);
                expect(reportedTotal).toBeCloseTo(grandTotal, 8);

                // ── Deterministic order: canonical SESSION_TYPES order ──────────────────
                const expectedOrder = SESSION_TYPES.filter((t) => expectedByType.has(t));
                expect(reportedTypes).toEqual(expectedOrder);
            }),
            { numRuns: NUM_RUNS },
        );
    });
});
