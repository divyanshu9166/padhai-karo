/**
 * Pure Efficiency_Score computation for the Daily Time Audit / Study Velocity Service
 * (task 10.2; design "Efficiency Score & Study Velocity"; Req 14.4).
 *
 * The Efficiency_Score is the ratio of total actual study time to total planned study time
 * across the User's entire Daily_Time_Audit history (Req 14.4):
 *
 *   efficiencyScore = Σ actualMin / Σ plannedMin
 *
 * This module isolates that ratio as a framework- and database-free pure function so it can
 * be unit-tested without a live DB and reused by the property test (Property 28 / task 10.4)
 * and by timetable efficiency auto-scaling (Req 14.5).
 *
 * ── Undefined / zero-planned convention ─────────────────────────────────────────────────
 * When there are no audits, or the summed planned time is `0`, the ratio is mathematically
 * undefined (division by zero). Per the design ("Undefined (no audits / zero planned) is
 * treated as `1` for scaling purposes") this function returns `1` in those cases: a score of
 * `1` means "on plan", so a user with no history (or no planned time) is treated as neither
 * ahead nor behind and triggers no efficiency under-scaling (Req 14.5).
 */

/**
 * The two fields of a Daily_Time_Audit this computation needs. Deliberately minimal so
 * callers can pass any row shape that carries planned/actual minutes.
 */
export interface EfficiencyAuditRow {
    plannedMin: number;
    actualMin: number;
}

/** The value returned for an undefined ratio (no audits, or zero total planned time). */
export const DEFAULT_EFFICIENCY_SCORE = 1;

/**
 * Compute the Efficiency_Score across a Daily_Time_Audit history (Req 14.4).
 *
 * @param audits - the user's complete audit history (order irrelevant). Each row
 *   contributes its `plannedMin` and `actualMin` to the respective totals.
 * @returns `Σ actualMin / Σ plannedMin`, or {@link DEFAULT_EFFICIENCY_SCORE} (`1`) when the
 *   history is empty or the total planned minutes is `0`.
 *
 * Pure: no I/O, no mutation of inputs.
 */
export function computeEfficiencyScore(audits: readonly EfficiencyAuditRow[]): number {
    let totalPlanned = 0;
    let totalActual = 0;
    for (const audit of audits) {
        totalPlanned += audit.plannedMin;
        totalActual += audit.actualMin;
    }

    if (totalPlanned <= 0) {
        return DEFAULT_EFFICIENCY_SCORE;
    }

    return totalActual / totalPlanned;
}
