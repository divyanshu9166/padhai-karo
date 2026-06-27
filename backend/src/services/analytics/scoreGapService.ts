/**
 * Score-Gap service handler (task 18.2; design "Target Cutoff selection & Score-Gap
 * endpoints" section 4 + "Error Handling"; Req 4.2, 4.3, 4.4, 4.5, 14.2).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/analytics/score-gap
 *     -> 200 ScoreGapResult              (discriminated GAP | MET | INSUFFICIENT_DATA)
 *     -> 422 TARGET_CUTOFF_REQUIRED       (no Target_College_Cutoff selected — Req 4.4)
 *     -> 503 REFERENCE_DATA_UNAVAILABLE   (no ScoreStandingMap for the user's track — Req 5.4)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 layering convention (see
 * {@link ./rankPredictionService} and {@link ./cutoffService}). It only orchestrates I/O,
 * per-user scoping, and serialization; all comparison math lives in the pure, DB-free
 * {@link computeScoreGap}:
 *   1. Load the requesting user's single `TargetCollegeCutoffSelection` (unique by
 *      `userId`, so the query is inherently per-user scoped — Req 14.2). Without a
 *      selection, respond `422 TARGET_CUTOFF_REQUIRED` (Req 4.4).
 *   2. Resolve the selected `CutoffReferenceData` row to its `(closingValue, unit)` target
 *      and the cutoff dataset's `referenceDataYear` (Req 4.5). A selection whose referenced
 *      cutoff has since disappeared is treated as "no usable selection" (`422`).
 *   3. Compute the user's current `RankPredictionResult` by reusing the shared
 *      {@link computeUserRankPrediction} pipeline (profile → active ScoreStandingMap →
 *      trajectory → predict), every query scoped by `ctx.user.id`. When the standing-map
 *      reference data is unavailable, respond `503 REFERENCE_DATA_UNAVAILABLE` (Req 5.4).
 *   4. Delegate to the pure {@link computeScoreGap}, which returns the discriminated
 *      `ScoreGapResult` — `GAP` (Req 4.2), `MET` with margin (Req 4.3), or propagated
 *      `INSUFFICIENT_DATA` — always carrying the cutoff `referenceDataYear` (Req 4.5).
 *
 * The route file wraps this handler with `withAuth`, so unauthenticated requests are
 * rejected with `401 UNAUTHORIZED` before the handler runs (Req 14.1).
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import type { CutoffUnit } from '../../lib/analytics/cutoffCatalog';
import { computeUserRankPrediction } from './rankPredictionService';
import { computeScoreGap, type TargetCutoff } from './scoreGap';

/**
 * Handle `GET /api/analytics/score-gap`. Reports how far the user's current Rank_Prediction
 * is from the standing required by their selected Target_College_Cutoff, in the cutoff's
 * units, surfacing the target-required and reference-unavailable states (Req 4.2–4.5, 14.2).
 */
export async function getScoreGapHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    // 1. The user's single target-cutoff selection (per-user scoped via unique userId).
    const selection = await prisma.targetCollegeCutoffSelection.findUnique({
        where: { userId: auth.user.id },
    });

    if (!selection) {
        return errorResponse(
            422,
            ErrorCode.TARGET_CUTOFF_REQUIRED,
            'Select a target college cutoff before requesting the score gap.',
        );
    }

    // 2. Resolve the selected cutoff row to its target value/unit and reference year.
    const cutoff = await prisma.cutoffReferenceData.findUnique({
        where: { id: selection.cutoffReferenceId },
        select: { closingValue: true, unit: true, referenceDataYear: true },
    });

    if (!cutoff) {
        // The selection points at a cutoff that no longer exists; treat as no usable target.
        return errorResponse(
            422,
            ErrorCode.TARGET_CUTOFF_REQUIRED,
            'Select a target college cutoff before requesting the score gap.',
        );
    }

    const target: TargetCutoff = {
        closingValue: cutoff.closingValue,
        unit: cutoff.unit as CutoffUnit,
    };

    // 3. Compute the user's current Rank_Prediction via the shared pipeline (Req 14.2).
    const prediction = await computeUserRankPrediction(auth.user.id);

    if (prediction.kind === 'REFERENCE_UNAVAILABLE') {
        return errorResponse(
            503,
            ErrorCode.REFERENCE_DATA_UNAVAILABLE,
            'No score-standing reference data is available for your exam track.',
        );
    }

    // 4. Delegate the comparison to the pure module, echoing the cutoff reference year.
    const result = computeScoreGap(prediction.result, target, cutoff.referenceDataYear);

    return Response.json(result, { status: 200 });
}
