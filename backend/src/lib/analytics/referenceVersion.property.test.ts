/**
 * Property-based test for the active reference-data version resolver (task 2.2).
 *
 *   - Property 8 (task 2.2): active reference-data version selection (Req 5.2, 6.3).
 *
 * Phase 2 ships year-versioned reference datasets keyed by `(examTrack, referenceDataYear)`.
 * Loading a later year is additive, so several years coexist for a track; the *active*
 * version is the maximum (most recent) `referenceDataYear` present for the requested
 * `(examTrack, datasetType)`. When no rows exist the resolver returns `null` so callers can
 * surface REFERENCE_DATA_UNAVAILABLE.
 *
 * The resolver reads through the Phase 1 Prisma singleton (`lib/db`), so this test mocks
 * the client (vi.hoisted + vi.mock('@/lib/db')) to stay database-free. Each dataset type
 * routes to a different Prisma model's `aggregate`; we model `aggregate` itself by computing
 * `_max.referenceDataYear` from a generated set of rows, so the property exercises the real
 * "max year wins" selection rather than a hand-fed answer.
 *
 * A single fast-check assertion running a minimum of 100 iterations.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const { aggregateCutoff, aggregateScoreStanding, aggregateTopicFrequency } = vi.hoisted(
    () => ({
        aggregateCutoff: vi.fn(),
        aggregateScoreStanding: vi.fn(),
        aggregateTopicFrequency: vi.fn(),
    }),
);

vi.mock('@/lib/db', () => {
    const prisma = {
        cutoffReferenceData: { aggregate: aggregateCutoff },
        scoreStandingMap: { aggregate: aggregateScoreStanding },
        topicFrequencyReferenceData: { aggregate: aggregateTopicFrequency },
    };
    return { default: prisma, prisma };
});

import { ReferenceDatasetType } from '@prisma/client';
import type { ExamTrack } from '../reference';
import { resolveActiveReferenceYear } from './referenceVersion';

const EXAM_TRACKS: ExamTrack[] = ['JEE', 'NEET'];
const DATASET_TYPES = [
    ReferenceDatasetType.CUTOFF,
    ReferenceDatasetType.SCORE_STANDING_MAP,
    ReferenceDatasetType.TOPIC_FREQUENCY,
] as const;

/** Maps a dataset type to the mocked `aggregate` fn the resolver will call for it. */
const AGGREGATE_BY_TYPE: Record<ReferenceDatasetType, ReturnType<typeof vi.fn>> = {
    [ReferenceDatasetType.CUTOFF]: aggregateCutoff,
    [ReferenceDatasetType.SCORE_STANDING_MAP]: aggregateScoreStanding,
    [ReferenceDatasetType.TOPIC_FREQUENCY]: aggregateTopicFrequency,
};

/**
 * Faithful stand-in for Prisma's `aggregate({ where, _max })`: given the rows that exist
 * for a track, return `_max.referenceDataYear = max(years)` (or `null` when there are none),
 * exactly as a real DB aggregate would.
 */
function aggregateImpl(rows: number[]) {
    return Promise.resolve({
        _max: { referenceDataYear: rows.length === 0 ? null : Math.max(...rows) },
    });
}

beforeEach(() => {
    aggregateCutoff.mockReset();
    aggregateScoreStanding.mockReset();
    aggregateTopicFrequency.mockReset();
});

describe('active reference-data version selection', () => {
    // Feature: performance-analytics, Property 8: For any non-empty set of available
    // reference-data years for a (track, datasetType), the resolver selects the maximum
    // (most recent) year; and returns null when no rows exist.
    it('Property 8: resolves the maximum available year, or null when no rows exist (Req 5.2, 6.3)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom(...EXAM_TRACKS),
                fc.constantFrom(...DATASET_TYPES),
                // Non-empty set of distinct candidate years, plus an empty-set flag.
                fc.uniqueArray(fc.integer({ min: 2000, max: 2100 }), {
                    minLength: 1,
                    maxLength: 12,
                }),
                fc.boolean(),
                async (examTrack, datasetType, years, isEmpty) => {
                    const rows = isEmpty ? [] : years;
                    const aggregate = AGGREGATE_BY_TYPE[datasetType];
                    aggregate.mockImplementation(() => aggregateImpl(rows));

                    const result = await resolveActiveReferenceYear(examTrack, datasetType);

                    if (isEmpty) {
                        // No rows for the (track, datasetType) -> explicit null "no data".
                        expect(result).toBeNull();
                    } else {
                        // Active version is the most recent (maximum) available year.
                        expect(result).toBe(Math.max(...years));
                    }

                    // The resolver must scope its query to the requested track only.
                    expect(aggregate).toHaveBeenCalledWith(
                        expect.objectContaining({ where: { examTrack } }),
                    );
                },
            ),
            { numRuns: 100 },
        );
    });
});
