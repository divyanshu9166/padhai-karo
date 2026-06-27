/**
 * Catalog-completeness smoke test for the Performance Analytics bilingual strings (Req 15.3).
 *
 * Req 15.3: "THE System SHALL provide English and Hindi strings for all new user-facing
 * Performance Analytics labels and messages."
 *
 * This smoke test guards two invariants over the `analytics.*` slice of the shipped catalog:
 *   1. Every `analytics.*` key has a non-empty English (`en`) value — `en` is the source of
 *      truth and the universal fallback, so a blank one is always a defect.
 *   2. Every `analytics.*` key has a non-empty Hindi (`hi`) value — task 27.1 added Hindi for
 *      all analytics keys, so full Hindi coverage is expected. Any missing/blank `hi` is
 *      reported by key for an actionable failure.
 *
 * A handful of structural assertions confirm the expected analytics key groups are present so
 * accidental deletion of a whole group is caught too.
 */

import { describe, expect, it } from 'vitest';
import { stringCatalog } from './catalog';

const ANALYTICS_PREFIX = 'analytics.';

const analyticsKeys = (Object.keys(stringCatalog) as Array<keyof typeof stringCatalog>).filter(
    (key) => key.startsWith(ANALYTICS_PREFIX),
);

const isNonEmpty = (value: string | undefined): value is string =>
    typeof value === 'string' && value.trim().length > 0;

describe('analytics catalog completeness (Req 15.3)', () => {
    it('exposes at least one analytics.* key', () => {
        // Sanity check: the filter above actually matched the analytics slice.
        expect(analyticsKeys.length).toBeGreaterThan(0);
    });

    it('every analytics.* key has a non-empty English (en) value (Req 15.3)', () => {
        const missingEn = analyticsKeys.filter((key) => !isNonEmpty(stringCatalog[key].en));
        expect(missingEn).toEqual([]);
    });

    it('every analytics.* key has a non-empty Hindi (hi) value (Req 15.3)', () => {
        // Task 27.1 provided Hindi for all analytics keys, so full coverage is expected.
        // Report the offending keys (not just a count) so a regression is actionable.
        const missingHi = analyticsKeys.filter(
            (key) => !isNonEmpty((stringCatalog[key] as { hi?: string }).hi),
        );
        expect(missingHi).toEqual([]);
    });

    it('contains the expected analytics.* key groups', () => {
        // Spot-check representative keys across each functional group (Req 1–12, 15) so the
        // accidental removal of a whole feature's strings is caught by the smoke test.
        const expectedKeys: Array<keyof typeof stringCatalog> = [
            // External mock source names (Req 1)
            'analytics.mockSource.allen',
            'analytics.mockSource.aakash',
            'analytics.mockSource.other',
            // Score trajectory (Req 2)
            'analytics.trajectory.title',
            'analytics.trajectory.empty',
            // Rank / percentile / score-range prediction (Req 3)
            'analytics.rank.title',
            'analytics.rank.jeePercentile',
            'analytics.rank.neetScoreRange',
            // Target cutoff & score-improvement gap (Req 4, 5)
            'analytics.targetCutoff.title',
            'analytics.scoreGap.title',
            'analytics.scoreGap.needed',
            // Topic trend analysis (Req 7)
            'analytics.topicTrend.title',
            // Topic prioritization incl. high-frequency-and-weak (Req 8)
            'analytics.topicPriority.title',
            'analytics.topicPriority.highFreqAndWeak',
            // Attempt quality metrics + trend directions (Req 9, 10)
            'analytics.quality.title',
            'analytics.quality.direction.increased',
            'analytics.quality.direction.decreased',
            'analytics.quality.direction.unchanged',
            // Weak-area detection & ranking (Req 11, 12)
            'analytics.weakArea.title',
            'analytics.weakArea.score',
            // Insufficient-data / reference-unavailable / target-required messages
            'analytics.insufficientData.rankPrediction',
            'analytics.insufficientData.qualityTrend',
            'analytics.referenceUnavailable',
            'analytics.targetCutoffRequired',
        ];

        const presentKeys = new Set<string>(analyticsKeys);
        const absent = expectedKeys.filter((key) => !presentKeys.has(key));
        expect(absent).toEqual([]);
    });
});
