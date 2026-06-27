/**
 * Pure Combined_Weightage_Signal computation (task 4.1; design "Components and
 * Interfaces → Pure layer → `signal.ts`"; Req 3.1, 3.2, 3.3, 3.4, 3.5).
 *
 * This module fuses the two per-Chapter frequency signals produced upstream by
 * `frequency.ts` — the user's own `PYQ_Chapter_Frequency` and the historical
 * `Historical_Chapter_Frequency` read from the active Topic_Frequency_Reference_Data
 * — into a single normalized prioritization measure, the Combined_Weightage_Signal,
 * used to rank Chapters (`ranking.ts`) and to compute the Suggested_Time_Allocation
 * (`allocation.ts`).
 *
 * Following the established Phase 1 / Performance Analytics layering convention
 * (see `src/services/analytics/topicPriority.ts`, `src/lib/timetable/allocation.ts`),
 * this module:
 *   - imports no Prisma client and no framework code,
 *   - accepts already-read plain inputs and never mutates them (returns a new
 *     array of new objects),
 *   - is the property-test surface for combined-signal behavior (tasks 4.2/4.3,
 *     Properties 3 and 4).
 *
 * ── Combination (Req 3.1, 3.3, 3.4, 3.5) ─────────────────────────────────────
 *   rawSignal = WPYQ * pyqFrequency + WHIST * historicalFrequency
 *
 * Both weights in {@link SIGNAL_WEIGHTS} are strictly positive and both inputs
 * are non-negative, so:
 *   - `rawSignal` is itself non-negative (Req 3.1);
 *   - increasing either input while holding the other constant cannot decrease
 *     `rawSignal` — it is monotonic non-decreasing in each input (Req 3.1);
 *   - when only one input is positive the signal derives from that input alone,
 *     because the other contributes `weight * 0 = 0` (Req 3.3, 3.4);
 *   - when both inputs are zero the `rawSignal` is `0` (Req 3.5).
 *
 * ── Normalization (Req 3.2, 3.5) ─────────────────────────────────────────────
 * `combinedWeightageSignal` is the min-max normalization of `rawSignal` across
 * the supplied Chapters onto the inclusive range `[0, 1]`:
 *   norm(x) = (x - min) / (max - min)
 * so the Chapter with the highest pre-normalization signal is assigned `1` and
 * the Chapter with the lowest is assigned `0` (Req 3.2). In the degenerate case
 * where every Chapter's `rawSignal` is equal (`max === min`) — which includes
 * the single-Chapter case and, crucially, the all-zero case (Req 3.5) — there is
 * no spread to scale against, so every Chapter is assigned `0`.
 */

/**
 * The per-Chapter frequency inputs consumed by {@link combinedWeightageSignal}.
 * A minimal, DB-free shape assembled by the service layer from the outputs of
 * `frequency.ts` (`pyqChapterFrequency` and `historicalChapterFrequency`).
 */
export interface ChapterSignalInput {
    /** The Chapter's stable identifier. */
    chapterId: string;
    /** == Phase 1 `Chapter.referenceKey`; the deterministic ranking tiebreak key. */
    referenceKey: string;
    /** The user's PYQ_Chapter_Frequency for this Chapter; `>= 0` (Req 1). */
    pyqFrequency: number;
    /** The Historical_Chapter_Frequency (avg questions/year) for this Chapter; `>= 0` (Req 2). */
    historicalFrequency: number;
    /** `false` when no Topic_Frequency_Record matched this Chapter (Req 2.3, 2.4). */
    hasHistoricalData: boolean;
}

/**
 * A Chapter's frequency inputs augmented with its combined signal values
 * (design Topic Prioritization analogue: the input shape carried through plus
 * the computed `rawSignal` and normalized `combinedWeightageSignal`).
 */
export interface ChapterSignal extends ChapterSignalInput {
    /**
     * Pre-normalization combined value `WPYQ*pyqFrequency + WHIST*historicalFrequency`:
     * non-negative and monotonic non-decreasing in each input (Req 3.1, 3.3, 3.4, 3.5).
     */
    rawSignal: number;
    /**
     * Min-max normalization of `rawSignal` across the supplied Chapters onto
     * `[0, 1]`: highest raw → `1`, lowest → `0`, all-equal/all-zero → `0` (Req 3.2, 3.5).
     */
    combinedWeightageSignal: number;
}

/**
 * Fixed, strictly positive relative weights of the two frequency components
 * (Req 3.1). Positivity is what guarantees the `rawSignal` is non-negative and
 * monotonic non-decreasing in each input. The PYQ and historical signals are
 * weighted equally: the combined measure is meant to blend the user's own
 * practice with the historical paper pattern without letting either dominate.
 * Exported so the service and the property tests reference the same constants.
 */
export const SIGNAL_WEIGHTS: { pyq: number; historical: number } = {
    /** `WPYQ`: weight on `pyqFrequency`. */
    pyq: 0.5,
    /** `WHIST`: weight on `historicalFrequency`. */
    historical: 0.5,
};

/**
 * Build a min-max normalizer over `values`, scaling each into `[0, 1]`.
 *
 * Returns a closure `norm(x) = (x - min) / (max - min)`. In the degenerate case
 * where every value is equal (`max === min`) — covering the single-value and
 * all-zero cases — there is no spread, so the normalizer returns `0` for every
 * input (Req 3.5). The returned closure does not depend on the order of `values`.
 */
function makeMinMaxNormalizer(values: readonly number[]): (value: number) => number {
    if (values.length === 0) {
        return () => 0;
    }
    let min = values[0];
    let max = values[0];
    for (const value of values) {
        if (value < min) {
            min = value;
        }
        if (value > max) {
            max = value;
        }
    }
    const range = max - min;
    if (range === 0) {
        return () => 0;
    }
    return (value: number) => (value - min) / range;
}

/**
 * Compute the Combined_Weightage_Signal for each Chapter from its PYQ and
 * historical frequency inputs (Req 3.1, 3.2, 3.3, 3.4, 3.5).
 *
 * For each input Chapter: compute `rawSignal = WPYQ*pyqFrequency +
 * WHIST*historicalFrequency` (non-negative, monotonic non-decreasing in each
 * input), then assign `combinedWeightageSignal` as the min-max normalization of
 * `rawSignal` across the supplied Chapters (highest → `1`, lowest → `0`,
 * all-equal/all-zero → `0`). The output preserves input order — ordering is the
 * responsibility of `ranking.ts`.
 *
 * Pure: performs no I/O, builds and returns a new array of new objects, and
 * mutates neither `inputs` nor any of its elements. An empty input yields an
 * empty result.
 *
 * @param inputs The Chapters' PYQ and historical frequency signals.
 */
export function combinedWeightageSignal(
    inputs: readonly ChapterSignalInput[],
): ChapterSignal[] {
    const rawSignals = inputs.map(
        (input) =>
            SIGNAL_WEIGHTS.pyq * input.pyqFrequency +
            SIGNAL_WEIGHTS.historical * input.historicalFrequency,
    );

    const normalize = makeMinMaxNormalizer(rawSignals);

    return inputs.map((input, index) => {
        const rawSignal = rawSignals[index];
        return {
            chapterId: input.chapterId,
            referenceKey: input.referenceKey,
            pyqFrequency: input.pyqFrequency,
            historicalFrequency: input.historicalFrequency,
            hasHistoricalData: input.hasHistoricalData,
            rawSignal,
            combinedWeightageSignal: normalize(rawSignal),
        };
    });
}
