import { describe, expect, it } from 'vitest';

import {
    resolveActualMin,
    sumFocusedMinutes,
    type AuditFocusSession,
} from './resolveActualMin';

/**
 * DB-independent unit tests for the actual-study-time derivation (task 10.1; Req 14.2/14.3).
 *
 * The pure function decides the Daily_Time_Audit actual minutes from the day's recorded
 * Focus_Sessions and the user-entered fallback. The numbered property test (Property 27) is
 * task 10.3; these are example/edge-case tests only.
 */
function sessions(...mins: number[]): AuditFocusSession[] {
    return mins.map((focusedDurationMin) => ({ focusedDurationMin }));
}

describe('sumFocusedMinutes', () => {
    it('returns 0 for an empty list', () => {
        expect(sumFocusedMinutes([])).toBe(0);
    });

    it('sums focused durations across sessions', () => {
        expect(sumFocusedMinutes(sessions(25, 50, 15))).toBe(90);
    });
});

describe('resolveActualMin', () => {
    it('sums the day\'s focus sessions when sessions exist (Req 14.2)', () => {
        expect(resolveActualMin(sessions(30, 45), 999)).toBe(75);
    });

    it('uses the user-entered value when no sessions exist (Req 14.3)', () => {
        expect(resolveActualMin([], 120)).toBe(120);
    });

    it('lets sessions win over the user-entered value when both are present (Req 14.2)', () => {
        // Sessions are the source of truth: the user-entered 5 is ignored entirely.
        expect(resolveActualMin(sessions(40, 20), 5)).toBe(60);
    });

    it('defaults to 0 when there are neither sessions nor a user-entered value', () => {
        expect(resolveActualMin([], null)).toBe(0);
        expect(resolveActualMin([], undefined)).toBe(0);
    });

    it('returns a single session\'s duration unchanged', () => {
        expect(resolveActualMin(sessions(50), null)).toBe(50);
    });

    it('returns the session sum (which may be 0) rather than the user value when a zero-minute session exists', () => {
        // A recorded session exists, so the sessions branch wins even when it sums to 0.
        expect(resolveActualMin(sessions(0), 90)).toBe(0);
    });
});
