/**
 * Catalog-completeness smoke test for the Weightage-Based Time Allocation bilingual strings
 * (Req 11.4).
 *
 * Req 11.4: "THE System SHALL provide non-empty English and Hindi strings for 100 percent of
 * new user-facing weightage-based time-allocation labels and messages, such that every catalog
 * key has both an English value and a Hindi value."
 *
 * This smoke test guards two invariants over the `allocation.*` slice of the shipped catalog:
 *   1. Every `allocation.*` key has a non-empty English (`en`) value — `en` is the source of
 *      truth and the universal fallback, so a blank one is always a defect.
 *   2. Every `allocation.*` key has a non-empty Hindi (`hi`) value — task 2.1 added Hindi for
 *      all allocation keys, so full Hindi coverage is expected. Any missing/blank `hi` is
 *      reported by key for an actionable failure.
 *
 * A handful of structural assertions confirm the expected allocation key groups are present so
 * accidental deletion of a whole group is caught too.
 */

import { describe, expect, it } from 'vitest';
import { stringCatalog } from './catalog';

const ALLOCATION_PREFIX = 'allocation.';

const allocationKeys = (Object.keys(stringCatalog) as Array<keyof typeof stringCatalog>).filter(
    (key) => key.startsWith(ALLOCATION_PREFIX),
);

const isNonEmpty = (value: string | undefined): value is string =>
    typeof value === 'string' && value.trim().length > 0;

describe('allocation catalog completeness (Req 11.4)', () => {
    it('exposes at least one allocation.* key', () => {
        // Sanity check: the filter above actually matched the allocation slice.
        expect(allocationKeys.length).toBeGreaterThan(0);
    });

    it('every allocation.* key has a non-empty English (en) value (Req 11.4)', () => {
        const missingEn = allocationKeys.filter((key) => !isNonEmpty(stringCatalog[key].en));
        expect(missingEn).toEqual([]);
    });

    it('every allocation.* key has a non-empty Hindi (hi) value (Req 11.4)', () => {
        // Task 2.1 provided Hindi for all allocation keys, so full coverage is expected.
        // Report the offending keys (not just a count) so a regression is actionable.
        const missingHi = allocationKeys.filter(
            (key) => !isNonEmpty((stringCatalog[key] as { hi?: string }).hi),
        );
        expect(missingHi).toEqual([]);
    });

    it('contains the expected allocation.* key groups', () => {
        // Spot-check representative keys across each functional group (Req 2-7) so the
        // accidental removal of a whole feature's strings is caught by the smoke test.
        const expectedKeys: Array<keyof typeof stringCatalog> = [
            // Heading + reference year
            'allocation.title',
            'allocation.referenceYear',
            // Most-frequent chapters (Req 4)
            'allocation.mostFrequent.title',
            'allocation.mostFrequent.subtitle',
            'allocation.mostFrequent.empty',
            // Combined-signal component labels (Req 3, 4.2)
            'allocation.signal.pyqFrequency',
            'allocation.signal.historicalFrequency',
            'allocation.signal.combined',
            // Fallback / "no historical data" label (Req 2.3, 2.4)
            'allocation.signal.noHistoricalData',
            // Suggested time allocation (Req 5, 6)
            'allocation.suggested.title',
            'allocation.suggested.subtitle',
            'allocation.suggested.share',
            'allocation.suggested.empty',
            // Allocation-share source labels (Req 6.2)
            'allocation.suggested.source.suggested',
            'allocation.suggested.source.weightageFallback',
            // Default-weightage flag label (Req 6.3)
            'allocation.suggested.defaultWeightage',
            // Effective allocation mode labels (Req 7)
            'allocation.mode.title',
            'allocation.mode.suggested',
            'allocation.mode.phase1Default',
            // Reference-data-unavailable message (Req 2.4, 3.7, 9.5)
            'allocation.referenceUnavailable',
        ];

        const presentKeys = new Set<string>(allocationKeys);
        const absent = expectedKeys.filter((key) => !presentKeys.has(key));
        expect(absent).toEqual([]);
    });
});
