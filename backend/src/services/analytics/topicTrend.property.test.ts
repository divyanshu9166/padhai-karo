/**
 * Property-based test for the pure Topic-Trend projection, zero-fill, and ordering logic
 * (task 8.2, design "Topic Trend endpoint" and the "Topic trend ordering & zero-fill"
 * algorithm).
 *
 *   - Property 9 (task 8.2): topic trend projection, zero-fill, and ordering
 *     (Req 7.1, 7.2, 7.3).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed next to the
 * {@link projectTopicTrends} logic it validates. Generators produce a unique-`topicKey`
 * Topic universe and a frequency-record set drawn as a subset of that universe (so some
 * topics match and some are zero-filled) plus possibly extra unmatched records (whose
 * `topicKey` is absent from the universe and must be ignored), so the property exercises
 * coverage, correct projection vs zero-fill by membership, and non-increasing ordering by
 * `avgQuestionsPerYear` across a wide input space.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    projectTopicTrends,
    type ActiveTopicFrequencyRecord,
    type TopicUniverseEntry,
} from './topicTrend';

// Run the full validation count regardless of the lighter global default (vitest.setup.ts).
const NUM_RUNS = Math.max(
    100,
    Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10) || 0,
);

// A small alphabet of candidate topic keys; we draw a unique subset for the universe and a
// (possibly overlapping, possibly disjoint) subset for the frequency records so matched,
// zero-filled, and extra-unmatched cases all arise.
const CANDIDATE_KEYS = Array.from({ length: 24 }, (_, i) => `topic-${i}`);

// A universe entry. `topicName` is drawn independently of `topicKey` so the tiebreak (by
// name) is exercised, including topics that share an `avgQuestionsPerYear` (all zero-filled
// topics share 0).
const arbUniverseEntry = (topicKey: string): fc.Arbitrary<TopicUniverseEntry> =>
    fc.record({
        topicKey: fc.constant(topicKey),
        topicName: fc.string({ minLength: 1, maxLength: 6 }),
        subjectName: fc.constantFrom('Physics', 'Chemistry', 'Maths', 'Biology'),
    });

// A unique-`topicKey` universe: pick a unique subset of candidate keys, then attach an
// arbitrary name/subject to each.
const arbUniverse: fc.Arbitrary<TopicUniverseEntry[]> = fc
    .uniqueArray(fc.constantFrom(...CANDIDATE_KEYS), { minLength: 0, maxLength: 12 })
    .chain((keys) =>
        keys.length === 0
            ? fc.constant([] as TopicUniverseEntry[])
            : fc.tuple(...keys.map((k) => arbUniverseEntry(k))),
    );

// An active frequency record for a given key, with a coherent year span and non-negative
// counts/averages.
const arbRecord = (topicKey: string): fc.Arbitrary<ActiveTopicFrequencyRecord> =>
    fc
        .tuple(
            fc.integer({ min: 0, max: 200 }),
            fc.integer({ min: 2000, max: 2024 }),
            fc.integer({ min: 0, max: 24 }),
            fc.double({ min: 0, max: 50, noNaN: true }),
        )
        .map(([appearanceCount, spanStart, spanLen, avgQuestionsPerYear]) => ({
            topicKey,
            appearanceCount,
            yearSpanStart: spanStart,
            yearSpanEnd: spanStart + spanLen,
            avgQuestionsPerYear,
        }));

// Active frequency records keyed by a unique subset of candidate keys (a record's key may or
// may not be present in the universe), so the test sees matched topics, zero-filled topics,
// and extra unmatched records that must be ignored.
const arbRecords: fc.Arbitrary<ActiveTopicFrequencyRecord[]> = fc
    .uniqueArray(fc.constantFrom(...CANDIDATE_KEYS), { minLength: 0, maxLength: 16 })
    .chain((keys) =>
        keys.length === 0
            ? fc.constant([] as ActiveTopicFrequencyRecord[])
            : fc.tuple(...keys.map((k) => arbRecord(k))),
    );

describe('topic trend projection properties', () => {
    // Feature: performance-analytics, Property 9: For any Topic universe (unique topicKeys)
    // and any active Topic_Frequency_Reference_Data record set, the projection includes every
    // universe Topic exactly once; a Topic with a matching record projects that record's
    // appearanceCount / avgQuestionsPerYear / yearSpan and hasFrequencyData=true; a Topic
    // without a record is zero-filled (appearanceCount=0, avgQuestionsPerYear=0,
    // yearSpan=null, hasFrequencyData=false); records whose key is not in the universe are
    // ignored; and the result is ordered non-increasing by avgQuestionsPerYear.
    it('Property 9: topic trend projection, zero-fill, and ordering (Req 7.1, 7.2, 7.3)', () => {
        fc.assert(
            fc.property(arbUniverse, arbRecords, (universe, records) => {
                const recordByKey = new Map<string, ActiveTopicFrequencyRecord>();
                for (const r of records) {
                    recordByKey.set(r.topicKey, r);
                }

                const trends = projectTopicTrends(universe, records);

                // ── Coverage: exactly one result per universe Topic (Req 7.1) ────────────
                expect(trends.length).toBe(universe.length);
                const resultKeys = trends.map((t) => t.topicKey).sort();
                const universeKeys = universe.map((u) => u.topicKey).sort();
                expect(resultKeys).toEqual(universeKeys);

                const universeByKey = new Map<string, TopicUniverseEntry>();
                for (const u of universe) {
                    universeByKey.set(u.topicKey, u);
                }

                for (const t of trends) {
                    const entry = universeByKey.get(t.topicKey);
                    expect(entry).toBeDefined();
                    // Identity always comes from the universe.
                    expect(t.topicName).toBe(entry?.topicName);
                    expect(t.subjectName).toBe(entry?.subjectName);

                    const record = recordByKey.get(t.topicKey);
                    if (record !== undefined) {
                        // ── Matched projection (Req 7.1) ────────────────────────────────
                        expect(t.hasFrequencyData).toBe(true);
                        expect(t.appearanceCount).toBe(record.appearanceCount);
                        expect(t.avgQuestionsPerYear).toBe(record.avgQuestionsPerYear);
                        expect(t.yearSpan).toEqual({
                            start: record.yearSpanStart,
                            end: record.yearSpanEnd,
                        });
                    } else {
                        // ── Zero-fill for topics with no record (Req 7.3) ───────────────
                        expect(t.hasFrequencyData).toBe(false);
                        expect(t.appearanceCount).toBe(0);
                        expect(t.avgQuestionsPerYear).toBe(0);
                        expect(t.yearSpan).toBeNull();
                    }
                }

                // ── Ordering: non-increasing by avgQuestionsPerYear (Req 7.2) ────────────
                for (let i = 1; i < trends.length; i += 1) {
                    expect(trends[i - 1].avgQuestionsPerYear).toBeGreaterThanOrEqual(
                        trends[i].avgQuestionsPerYear,
                    );
                }
            }),
            { numRuns: NUM_RUNS },
        );
    });
});
