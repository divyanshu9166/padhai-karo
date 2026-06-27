/**
 * Pure Score_Improvement_Gap computation (task 7.1; design "Score-improvement gap (Req 4)"
 * + the "Score-Gap endpoint"; Req 4.2, 4.3, 4.5).
 *
 * The Score-Gap capability tells a User how far their current estimated standing
 * (`Rank_Prediction`) is from the standing required by a selected `Target_College_Cutoff`,
 * expressed in the units of that cutoff. This module performs that comparison as a
 * framework- and database-free pure function, mirroring the Phase 1 layering convention
 * used by `trajectory.ts`, `rankPrediction.ts`, and `lib/scoring/score.ts`:
 *
 *   - imports no Prisma client and no framework code,
 *   - accepts already-resolved plain values (the thin service handler — task 18.2 — loads
 *     the User's `TargetCollegeCutoffSelection`, resolves the active cutoff dataset and its
 *     `referenceDataYear`, computes the current `RankPredictionResult`, then passes them in),
 *   - never mutates its inputs,
 *   - is the property-test surface for score-gap behavior (task 7.2 / Property 7).
 *
 * NOTE ON SCOPE: the "no target selection -> TARGET_CUTOFF_REQUIRED (422)" case (Req 4.4) is
 * handled at the service layer (task 18.2), NOT here. This pure module assumes a target
 * cutoff is always provided.
 *
 * ── Algorithm (design "Score-improvement gap") ─────────────────────────────────────────────
 *   Given the current {@link RankPredictionResult} and a target `(closingValue, unit)`:
 *     1. If the prediction is `INSUFFICIENT_DATA`, propagate it unchanged (no standing exists
 *        to compare yet).
 *     2. Otherwise compare in the cutoff's `unit`, which fixes the direction of "better":
 *          - `PERCENTILE` / `MARKS` — higher is better.
 *          - `RANK`              — lower is better.
 *        The User's standing is taken from the prediction band's **best-comparable bound**
 *        (see the convention below).
 *          - **MET**  when the standing meets/exceeds the cutoff (higher-is-better: standing
 *                     >= closingValue; lower-is-better: standing <= closingValue):
 *                     `{ kind: 'MET', margin: |standing - closingValue| }` (Req 4.3).
 *          - **GAP**  otherwise: `{ kind: 'GAP', gap: |closingValue - standing| }` (Req 4.2).
 *     3. Always include the cutoff dataset's `referenceDataYear` on a MET/GAP result
 *        (Req 4.5).
 *
 * ── Directional "best-comparable bound" convention (explicit & consistent) ──────────────────
 * The `Rank_Prediction` is always a *band* `{ low, high }` (never a single value). To compare
 * against a single cutoff value we pick the single bound that is most favorable to the User —
 * the optimistic edge of the band — chosen by the cutoff's direction of "better":
 *
 *   - cutoff `unit` is higher-is-better (`PERCENTILE` / `MARKS`)  -> use `estimate.high`
 *     (the optimistic top of the predicted percentile/marks band).
 *   - cutoff `unit` is lower-is-better (`RANK`)                   -> use `estimate.low`
 *     (the optimistic, i.e. numerically smallest, predicted rank).
 *
 * This bound is deterministic and consistent, so the property test (7.2) can rely on it:
 * for higher-is-better the comparable standing is `estimate.high`; for lower-is-better it is
 * `estimate.low`. The comparison and both magnitudes (`margin` / `gap`) are expressed in the
 * cutoff's units.
 */
import type { CutoffUnit } from '../../lib/analytics/cutoffCatalog';
import type { RankPredictionResult } from './rankPrediction';

/**
 * The selected Target_College_Cutoff to compare against, reduced to the two fields the
 * comparison needs. The service layer resolves this from the User's
 * `TargetCollegeCutoffSelection` -> `CutoffReferenceData` row.
 */
export interface TargetCutoff {
    /** Closing value required by the target, interpreted per `unit`. */
    closingValue: number;
    /** Unit the comparison is performed in (drives the direction of "better"). */
    unit: CutoffUnit;
}

/**
 * Discriminated Score_Improvement_Gap result.
 *   - `MET`               — the current standing meets/exceeds the cutoff; `margin` is the
 *                           absolute amount by which the cutoff is exceeded (Req 4.3).
 *   - `GAP`               — the current standing falls short; `gap` is the absolute distance
 *                           to the target standing (Req 4.2).
 *   - `INSUFFICIENT_DATA` — propagated from the underlying rank prediction (Req 3.4); no
 *                           standing is available to compare.
 *
 * `MET` and `GAP` always carry the cutoff dataset's `referenceDataYear` (Req 4.5).
 */
export type ScoreGapResult =
    | {
        kind: 'MET';
        margin: number;
        unit: CutoffUnit;
        referenceDataYear: number;
    }
    | {
        kind: 'GAP';
        gap: number;
        unit: CutoffUnit;
        referenceDataYear: number;
    }
    | {
        kind: 'INSUFFICIENT_DATA';
        minimumRequired: number;
    };

/** Whether a cutoff unit is "lower is better" (only `RANK`); otherwise higher is better. */
function isLowerBetter(unit: CutoffUnit): boolean {
    return unit === 'RANK';
}

/**
 * Compute the Score_Improvement_Gap from the current Rank_Prediction and the selected target
 * cutoff (design "Score-improvement gap"; Req 4.2, 4.3, 4.5).
 *
 * Pure: performs no I/O and mutates neither argument.
 *
 * @param prediction        The User's current `RankPredictionResult`. When `INSUFFICIENT_DATA`
 *                          it is propagated unchanged.
 * @param target            The selected target cutoff `{ closingValue, unit }`. The `unit`
 *                          drives the direction of comparison and is echoed on the result.
 * @param referenceDataYear The `Reference_Data_Year` of the cutoff dataset used, echoed on a
 *                          MET/GAP result (Req 4.5).
 * @returns `INSUFFICIENT_DATA` (propagated) when the prediction lacks data; otherwise `MET`
 *          with the exceed `margin` (Req 4.3) or `GAP` with the shortfall `gap` (Req 4.2),
 *          both in the cutoff's units and carrying the `referenceDataYear`.
 */
export function computeScoreGap(
    prediction: RankPredictionResult,
    target: TargetCutoff,
    referenceDataYear: number,
): ScoreGapResult {
    // (1) No standing yet — propagate insufficient-data unchanged.
    if (prediction.kind === 'INSUFFICIENT_DATA') {
        return {
            kind: 'INSUFFICIENT_DATA',
            minimumRequired: prediction.minimumRequired,
        };
    }

    const { closingValue, unit } = target;
    const lowerBetter = isLowerBetter(unit);

    // (2) The User's comparable standing = the prediction band's best-comparable (optimistic)
    // bound, chosen by the cutoff's direction of "better".
    const standing = lowerBetter ? prediction.estimate.low : prediction.estimate.high;

    // (3) Met when the standing meets/exceeds the cutoff in the cutoff's direction.
    const met = lowerBetter ? standing <= closingValue : standing >= closingValue;

    if (met) {
        return {
            kind: 'MET',
            margin: Math.abs(standing - closingValue),
            unit,
            referenceDataYear,
        };
    }

    return {
        kind: 'GAP',
        gap: Math.abs(closingValue - standing),
        unit,
        referenceDataYear,
    };
}
