/**
 * Property-based test for the pure topic-prioritization combination, ordering,
 * flagging, and no-weak-areas fallback (task 12.2, design "Topic Prioritization
 * endpoint (Req 8, 12)" + Property 10).
 *
 *   - Property 10 (task 12.2): topic prioritization combination, ordering, flag,
 *     and no-weak-areas fallback (Req 8.1, 8.2, 8.3, 8.4).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed beside the
 * {@link prioritizeTopics} logic it validates.
 *
 * Property 10 (design): For any topic frequencies and per-topic weak-area scores, each
 * topic's `priority` equals `WFREQ*norm(avgQuestionsPerYear) + WWEAK*norm(weakAreaScore)`
 * where `norm` min-max-scales over the current topic set and returns `0` for every topic
 * when `max === min`; the result is ordered non-increasing by `priority` (tiebreak
 * `topicName` ascending); a topic is flagged `isHighFreqAndWeak` iff its
 * `avgQuestionsPerYear >= HIGH_FREQUENCY_THRESHOLD` AND it has a strictly positive
 * weak-area score; and when there are no weak areas (empty map) the ordering equals the
 * ordering by `avgQuestionsPerYear` (frequency) alone.
 *
 * The test generates a unique-`topicKey` frequency list (with `avgQuestionsPerYear` values
 * straddling `HIGH_FREQUENCY_THRESHOLD`) plus a weak-area map drawn from a subset of those
 * topic keys with positive scores (and exercises the empty-map case), then independently
 * recomputes the expected normalized components, priority, flag, and ordering using the
 * exported constants and asserts `prioritizeTopics` agrees.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    HIGH_FREQUENCY_THRESHOLD,
    TOPIC_PRIORITY_WEIGHTS,
    prioritizeTopics,
    type TopicFrequencyInput,
} from './topicPriority';

// Run the full validation count regardless of the lighter global default (vitest.setup.ts).
const NUM_RUNS = Math.max(
    100,
    Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10) || 0,
);

// A finite, non-negative average-questions-per-year value, with the [min, max] range chosen
// to straddle HIGH_FREQUENCY_THRESHOLD (=2) so generated topics fall on both sides of it.
const arbAvgQuestionsPerYear: fc.Arbitrary<number> = fc.double({
    min: 0,
    max: 6,
    noNaN: true,
    noDefaultInfinity: true,
});

// A strictly-positive weak-area score (the weak-area map only ever holds positive scores;
// "among the user's weak areas" means a positive score in buildWeakAreaScoreByTopic).
const arbPositiveWeakScore: fc.Arbitrary<number> = fc.double({
    min: Number.MIN_VALUE,
    max: 1000,
    noNaN: true,
    noDefaultInfinity: true,
});

// A frequency list with unique, prototype-safe topicKeys (the topic universe). Keys and
// names are derived from the index so they are total-ordering-stable and never collide with
// Object.prototype members (e.g. "valueOf"/"toString") — real topic keys are controlled
// Chapter.referenceKeys, so this matches the realistic input space while keeping uniqueness.
const arbFrequencyList: fc.Arbitrary<TopicFrequencyInput[]> = fc
    .array(arbAvgQuestionsPerYear, { minLength: 1, maxLength: 12 })
    .map((avgs) =>
        avgs.map((avgQuestionsPerYear, index) => {
            const suffix = String(index).padStart(2, '0');
            return {
                topicKey: `topic-key-${suffix}`,
                topicName: `topic-${suffix}`,
                avgQuestionsPerYear,
            };
        }),
    );

/** Reference min-max normalizer over a component's values; 0 for every value when max===min. */
function expectedNormalizer(values: readonly number[]): (value: number) => number {
    if (values.length === 0) {
        return () => 0;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    if (range === 0) {
        return () => 0;
    }
    return (value: number) => (value - min) / range;
}

describe('prioritizeTopics topic-prioritization properties', () => {
    // Feature: performance-analytics, Property 10: For any topic frequencies and per-topic
    // weak-area scores, each topic's priority == WFREQ*norm(avgQuestionsPerYear) +
    // WWEAK*norm(weakAreaScore) (norm min-max over the current set, 0 when max===min); topics
    // are ordered non-increasing by priority (tiebreak topicName ascending); a topic is flagged
    // high-freq-and-weak iff avgQuestionsPerYear >= HIGH_FREQUENCY_THRESHOLD AND it has a
    // positive weak-area score; and with no weak areas the ordering equals frequency alone.
    it('Property 10: topic prioritization combination, ordering, flag, and no-weak-areas fallback (Req 8.1, 8.2, 8.3, 8.4)', () => {
        fc.assert(
            fc.property(
                arbFrequencyList,
                // A subset of indices that will receive a positive weak-area score.
                fc.array(fc.nat(), { maxLength: 12 }),
                fc.array(arbPositiveWeakScore, { minLength: 0, maxLength: 12 }),
                // Force the empty-map (no-weak-areas) case a fair fraction of the time.
                fc.boolean(),
                (frequencies, rawIndices, scores, forceEmpty) => {
                    // Build the weak-area map from a subset of the topic keys with positive scores.
                    const weakAreaScoreByTopic: Record<string, number> = {};
                    if (!forceEmpty) {
                        for (let i = 0; i < rawIndices.length; i += 1) {
                            const topic = frequencies[rawIndices[i] % frequencies.length];
                            const score = scores[i % Math.max(scores.length, 1)];
                            if (score !== undefined) {
                                weakAreaScoreByTopic[topic.topicKey] = score;
                            }
                        }
                    }
                    const hasWeakAreas = Object.keys(weakAreaScoreByTopic).length > 0;

                    const result = prioritizeTopics(frequencies, weakAreaScoreByTopic);

                    // (0) One TopicPriority per input topic; same topic universe.
                    expect(result).toHaveLength(frequencies.length);
                    expect(new Set(result.map((r) => r.topicKey))).toEqual(
                        new Set(frequencies.map((f) => f.topicKey)),
                    );

                    // Independently recompute the normalized components over the current set.
                    const freqValues = frequencies.map((f) => f.avgQuestionsPerYear);
                    const weakValues = frequencies.map(
                        (f) => weakAreaScoreByTopic[f.topicKey] ?? 0,
                    );
                    const normFreq = expectedNormalizer(freqValues);
                    const normWeak = expectedNormalizer(weakValues);

                    const byKey = new Map(result.map((r) => [r.topicKey, r]));

                    // Build the independently-expected entries (same formula as the module),
                    // keyed for both the per-field checks and the ordering comparison below.
                    const expectedEntries = frequencies.map((freq) => {
                        const expectedWeakScore = weakAreaScoreByTopic[freq.topicKey] ?? 0;
                        const expectedPriority =
                            TOPIC_PRIORITY_WEIGHTS.frequency * normFreq(freq.avgQuestionsPerYear) +
                            TOPIC_PRIORITY_WEIGHTS.weakArea * normWeak(expectedWeakScore);
                        return {
                            topicKey: freq.topicKey,
                            topicName: freq.topicName,
                            avgQuestionsPerYear: freq.avgQuestionsPerYear,
                            expectedWeakScore,
                            expectedPriority,
                        };
                    });

                    for (const expected of expectedEntries) {
                        const entry = byKey.get(expected.topicKey)!;

                        // (1) Carried-through raw fields.
                        expect(entry.avgQuestionsPerYear).toBe(expected.avgQuestionsPerYear);
                        expect(entry.weakAreaScore).toBe(expected.expectedWeakScore);

                        // (2) Combination: priority equals the defined weighted normalized sum.
                        //     The recomputation mirrors the module's arithmetic exactly, so the
                        //     values match to full precision.
                        expect(entry.priority).toBe(expected.expectedPriority);

                        // (3) Flag: high-freq (raw threshold) AND a positive weak-area score.
                        const expectedFlag =
                            expected.avgQuestionsPerYear >= HIGH_FREQUENCY_THRESHOLD &&
                            expected.expectedWeakScore > 0;
                        expect(entry.isHighFreqAndWeak).toBe(expectedFlag);
                    }

                    // (4) Ordering: non-increasing by priority, tiebreak topicName ascending.
                    //     Compare against the independently-sorted expected order (same
                    //     comparator the module uses) rather than epsilon-classifying ties,
                    //     which is robust to genuine sub-epsilon priority gaps.
                    const expectedOrder = [...expectedEntries].sort((a, b) => {
                        if (b.expectedPriority !== a.expectedPriority) {
                            return b.expectedPriority - a.expectedPriority;
                        }
                        return a.topicName.localeCompare(b.topicName);
                    });
                    expect(result.map((r) => r.topicKey)).toEqual(
                        expectedOrder.map((e) => e.topicKey),
                    );

                    // (5) No-weak-areas fallback: with an empty map the ordering equals the
                    // ordering by avgQuestionsPerYear (frequency) alone, tiebreak topicName asc.
                    if (!hasWeakAreas) {
                        const expectedOrder = [...frequencies].sort((a, b) => {
                            if (b.avgQuestionsPerYear !== a.avgQuestionsPerYear) {
                                return b.avgQuestionsPerYear - a.avgQuestionsPerYear;
                            }
                            return a.topicName.localeCompare(b.topicName);
                        });
                        expect(result.map((r) => r.topicKey)).toEqual(
                            expectedOrder.map((f) => f.topicKey),
                        );
                    }
                },
            ),
            { numRuns: NUM_RUNS },
        );
    });
});
