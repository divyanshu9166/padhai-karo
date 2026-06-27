/**
 * Active reference-data version resolver (task 2.1).
 *
 * Phase 2 ships year-versioned reference datasets (cutoff data, the score-standing map,
 * and topic-frequency data) in additive tables keyed by `(examTrack, referenceDataYear)`.
 * Loading a later year is additive — prior years' rows are retained — so several years
 * coexist for a track. The design's reference-data versioning rule states the *active*
 * version is the **maximum (most recent) `referenceDataYear`** present for the requested
 * `examTrack` (Req 5.2, 6.3).
 *
 * This module is the single shared resolver every reference reader (rank prediction,
 * cutoff listing / score gap, topic trend, topic prioritization) calls to discover the
 * active year before it queries a dataset, so the "max year wins" rule lives in exactly
 * one place. It reads through the Phase 1 Prisma client singleton (`lib/db`) and selects
 * the table from the requested `ReferenceDatasetType`:
 *
 *  - `CUTOFF`             → `CutoffReferenceData`
 *  - `SCORE_STANDING_MAP` → `ScoreStandingMap`
 *  - `TOPIC_FREQUENCY`    → `TopicFrequencyReferenceData`
 *
 * When no rows exist for the requested `(examTrack, datasetType)` the resolver returns
 * `null` — a clear "no data" signal callers translate into a `REFERENCE_DATA_UNAVAILABLE`
 * response for any output that requires that dataset (Req 5.4).
 */
import { ReferenceDatasetType } from '@prisma/client';
import { prisma } from '../db';
import type { ExamTrack } from '../reference';

/**
 * Resolves the active (most recent) `referenceDataYear` for a reference dataset of the
 * given type, scoped to one `examTrack`.
 *
 * @param examTrack   The exam track whose reference data is being read (JEE or NEET).
 * @param datasetType Which year-versioned dataset to resolve the active version of.
 * @returns The maximum `referenceDataYear` available for `(examTrack, datasetType)`, or
 *          `null` when no rows exist (so callers can return REFERENCE_DATA_UNAVAILABLE).
 */
export async function resolveActiveReferenceYear(
    examTrack: ExamTrack,
    datasetType: ReferenceDatasetType,
): Promise<number | null> {
    switch (datasetType) {
        case ReferenceDatasetType.CUTOFF: {
            const { _max } = await prisma.cutoffReferenceData.aggregate({
                where: { examTrack },
                _max: { referenceDataYear: true },
            });
            return _max.referenceDataYear ?? null;
        }
        case ReferenceDatasetType.SCORE_STANDING_MAP: {
            const { _max } = await prisma.scoreStandingMap.aggregate({
                where: { examTrack },
                _max: { referenceDataYear: true },
            });
            return _max.referenceDataYear ?? null;
        }
        case ReferenceDatasetType.TOPIC_FREQUENCY: {
            const { _max } = await prisma.topicFrequencyReferenceData.aggregate({
                where: { examTrack },
                _max: { referenceDataYear: true },
            });
            return _max.referenceDataYear ?? null;
        }
        default: {
            // Exhaustiveness guard: a new ReferenceDatasetType must be handled explicitly
            // rather than silently resolving to "no data".
            const exhaustive: never = datasetType;
            throw new Error(`Unhandled ReferenceDatasetType: ${String(exhaustive)}`);
        }
    }
}
