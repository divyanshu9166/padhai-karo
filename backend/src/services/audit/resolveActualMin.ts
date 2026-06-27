/**
 * Pure actual-study-time derivation for the Daily Time Audit Service (task 10.1; design
 * "Daily Time Audit / Study Velocity Service"; Req 14.1, 14.2, 14.3).
 *
 * When a User completes an end-of-day check-in the Backend_API records a Daily_Time_Audit
 * holding the planned and the *actual* study time for that day (Req 14.1). The actual value
 * is derived, not blindly trusted, by the rule below; this module isolates that rule as a
 * framework- and database-free pure function so it can be unit-tested without a live DB and
 * reused by the property test (Property 27 / task 10.3):
 *
 *   - WHERE Focus_Session data exists for the day, the actual study time is the SUM of that
 *     day's Focus_Session focused durations (Req 14.2). Recorded sessions are the source of
 *     truth, so when at least one session exists for the day the user-entered value is
 *     ignored entirely (sessions win).
 *   - WHERE no Focus_Session data exists for the day, the actual study time is the value the
 *     User entered (Req 14.3).
 *   - WHERE no Focus_Session data exists AND the User also entered no value, the actual
 *     study time defaults to 0. (Documented choice: a check-in with neither recorded
 *     sessions nor a self-reported figure represents a day with zero logged study.)
 */

/**
 * The single field of a Focus_Session this derivation needs: the focused duration (in
 * minutes) that counts toward the day's actual study time. Deliberately minimal so callers
 * can pass any row shape that carries it.
 */
export interface AuditFocusSession {
    focusedDurationMin: number;
}

/**
 * Sum the focused durations (minutes) across the given sessions. Pure; returns 0 for an
 * empty list.
 */
export function sumFocusedMinutes(sessions: readonly AuditFocusSession[]): number {
    return sessions.reduce((total, session) => total + session.focusedDurationMin, 0);
}

/**
 * Resolve the Daily_Time_Audit actual study time for a day (Req 14.2/14.3).
 *
 * @param daySessions - the user's Focus_Sessions that fall on the audited day. When this is
 *   non-empty the result is their summed focused minutes (Req 14.2) and `userEnteredActual`
 *   is ignored.
 * @param userEnteredActual - the actual minutes the user typed into the check-in, or
 *   `null`/`undefined` when they entered none. Used only when there are no sessions for the
 *   day (Req 14.3); defaults to 0 when also absent.
 *
 * Pure: no I/O, no mutation of inputs.
 */
export function resolveActualMin(
    daySessions: readonly AuditFocusSession[],
    userEnteredActual: number | null | undefined,
): number {
    if (daySessions.length > 0) {
        return sumFocusedMinutes(daySessions);
    }
    return userEnteredActual ?? 0;
}
