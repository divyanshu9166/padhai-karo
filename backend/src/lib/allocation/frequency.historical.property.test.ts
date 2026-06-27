import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    type AllocationChapter,
    type ChapterStatus,
    type TopicFrequencyRecord,
    historicalChapterFrequency,
} from './frequency';

/**
 * Property-based test for the pure historical-frequency derivation (task 3.3).
 *
 * Feature: weightage-based-time-allocation, Property 2: Historical_Chapter_Frequency
 * equals active-year average or zero.
 *
 * Property 2 (design.md): for any set of Chapters and any (already active-year
 * selected) Topic_Frequency_Records, each Chapter's Historical_Chapter_Frequency
 * equals the `avgQuestionsPerYear` of the record whose `topicKey` matches the
 * Chapter's `referenceKey`; when no such record exists — including when no record
 * set exists at all — the value is zero and the Chapter is labeled as having no
 * historical frequency data (`hasHistoricalData === false`).
 *
 * The pure function receives only the already-selected active-year records, so
 * the active-version selection (Req 2.2) is exercised at the service layer; here
 * the empty-records case stands in for "no dataset exists for the track" (Req 2.4).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4
 */

// A small key pool so chapter referenceKeys and record topicKeys overlap often,
// exercising both the "match" and "no match" branches across many runs.
const KEY_POOL = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'unmatched-a', 'unmatched-b'];

const STATUSES: readonly ChapterStatus[] = [
    'NOT_STARTED',
    'IN_PROGRESS',
    'DONE',
    'REVISED',
];

/** Finite, non-negative averages — the natural domain of avgQuestionsPerYear. */
const avgArb: fc.Arbitrary<number> = fc.double({
    min: 0,
    max: 1000,
    noNaN: true,
    noDefaultInfinity: true,
});

/** Chapters with unique ids (the result is keyed by chapterId). */
const chaptersArb: fc.Arbitrary<AllocationChapter[]> = fc.uniqueArray(
    fc.record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        referenceKey: fc.constantFrom(...KEY_POOL),
        status: fc.constantFrom(...STATUSES),
        weightage: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), {
            nil: null,
        }),
        weightageIsDefault: fc.boolean(),
    }),
    { selector: (c) => c.id, maxLength: 12 },
);

const recordsArb: fc.Arbitrary<TopicFrequencyRecord[]> = fc.array(
    fc.record({
        topicKey: fc.constantFrom(...KEY_POOL),
        avgQuestionsPerYear: avgArb,
    }),
    { maxLength: 12 },
);

/**
 * Independent oracle mirroring the documented selection rule: the first record
 * carrying a topicKey wins (matching the implementation's first-occurrence
 * semantics for any duplicate topicKeys).
 */
function expectedAvgByKey(records: readonly TopicFrequencyRecord[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const r of records) {
        if (!map.has(r.topicKey)) {
            map.set(r.topicKey, r.avgQuestionsPerYear);
        }
    }
    return map;
}

describe('historicalChapterFrequency properties', () => {
    // Feature: weightage-based-time-allocation, Property 2: Historical_Chapter_Frequency
    // equals active-year average or zero.
    it('Property 2: each Chapter maps to its matching record average, else zero with no-data label', () => {
        fc.assert(
            fc.property(chaptersArb, recordsArb, (chapters, records) => {
                const result = historicalChapterFrequency(chapters, records);
                const avgByKey = expectedAvgByKey(records);

                // Every supplied Chapter appears exactly once.
                expect(result.size).toBe(chapters.length);

                for (const chapter of chapters) {
                    const entry = result.get(chapter.id);
                    expect(entry).toBeDefined();
                    if (avgByKey.has(chapter.referenceKey)) {
                        // Matching active-year record -> its avgQuestionsPerYear (Req 2.1).
                        expect(entry!.value).toBe(avgByKey.get(chapter.referenceKey));
                        expect(entry!.hasHistoricalData).toBe(true);
                    } else {
                        // No matching record -> zero and no-data label (Req 2.3).
                        expect(entry!.value).toBe(0);
                        expect(entry!.hasHistoricalData).toBe(false);
                    }
                }
            }),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 2: Historical_Chapter_Frequency
    // equals active-year average or zero (no-dataset case, Req 2.4).
    it('Property 2: with no records every Chapter is zero with no historical data', () => {
        fc.assert(
            fc.property(chaptersArb, (chapters) => {
                const result = historicalChapterFrequency(chapters, []);
                expect(result.size).toBe(chapters.length);
                for (const chapter of chapters) {
                    const entry = result.get(chapter.id);
                    expect(entry).toEqual({ value: 0, hasHistoricalData: false });
                }
            }),
            { numRuns: 100 },
        );
    });
});
