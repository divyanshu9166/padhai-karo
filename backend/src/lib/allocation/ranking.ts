/**
 * Pure Most_Frequent_Chapters ordering (task 5.1; design "Components and
 * Interfaces → Pure layer → `ranking.ts`"; Req 4.1, 4.3, 4.4, 4.5, 4.6).
 *
 * This module takes the per-Chapter {@link ChapterSignal}s produced by
 * `signal.ts` and orders them into the Most_Frequent_Chapters list — the triage
 * guidance surfaced to the user and the basis the Suggested_Time_Allocation
 * builds on.
 *
 * Following the established Phase 1 / Performance Analytics layering convention
 * (see `src/lib/allocation/signal.ts`, `src/services/analytics/topicPriority.ts`,
 * `src/lib/timetable/allocation.ts`), this module:
 *   - imports no Prisma client and no framework code,
 *   - accepts already-computed plain inputs and never mutates them (sorts a
 *     defensive copy and returns a new array — it does NOT sort in place),
 *   - is the property-test surface for ranking behavior (task 5.2, Property 5).
 *
 * ── Total, deterministic ordering (Req 4.1, 4.3, 4.4, 4.5, 4.6) ──────────────
 * Chapters are ordered by a strict cascade of comparison keys so that the order
 * is a *total* order (every pair is comparable) and *deterministic* (independent
 * of the input order):
 *   1. `combinedWeightageSignal` descending (Req 4.1);
 *   2. ties broken by `historicalFrequency` descending (Req 4.3);
 *   3. then by `pyqFrequency` descending (Req 4.4);
 *   4. finally by `referenceKey` ascending lexicographic (Req 4.5).
 *
 * Because every Chapter's `referenceKey` equals its unique Phase 1
 * `Chapter.referenceKey`, the final tiebreak is unique across distinct Chapters,
 * so the cascade never falls through to an undefined ordering — the result is a
 * single, stable permutation regardless of how `signals` was ordered on input.
 *
 * An empty input yields an empty list (Req 4.6).
 */

import type { ChapterSignal } from './signal';

/**
 * Order the supplied Chapter signals into the Most_Frequent_Chapters list
 * (Req 4.1, 4.3, 4.4, 4.5, 4.6).
 *
 * Returns every supplied Chapter ordered by `combinedWeightageSignal`
 * descending, breaking ties by `historicalFrequency` descending, then
 * `pyqFrequency` descending, then `referenceKey` ascending lexicographic, for a
 * total and deterministic ordering. An empty input yields an empty list.
 *
 * Pure: performs no I/O, sorts a shallow copy of `signals`, and mutates neither
 * the `signals` array nor any of its elements.
 *
 * @param signals The per-Chapter combined signals to rank.
 */
export function mostFrequentChapters(
    signals: readonly ChapterSignal[],
): ChapterSignal[] {
    return [...signals].sort((a, b) => {
        if (b.combinedWeightageSignal !== a.combinedWeightageSignal) {
            return b.combinedWeightageSignal - a.combinedWeightageSignal;
        }
        if (b.historicalFrequency !== a.historicalFrequency) {
            return b.historicalFrequency - a.historicalFrequency;
        }
        if (b.pyqFrequency !== a.pyqFrequency) {
            return b.pyqFrequency - a.pyqFrequency;
        }
        if (a.referenceKey < b.referenceKey) {
            return -1;
        }
        if (a.referenceKey > b.referenceKey) {
            return 1;
        }
        return 0;
    });
}
