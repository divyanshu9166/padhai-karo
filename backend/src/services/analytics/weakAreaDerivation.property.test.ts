/**
 * Property-based test for the pure weak-area derivation, mistake-category
 * folding, and empty-bucket exclusion logic (task 11.3, design "Weak-area
 * detection, scoring & ranking" steps 1–4).
 *
 *   - Property 14 (task 11.3): weak-area derivation, category counts, and
 *     exclusion (Req 11.1, 11.2, 11.4).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed next
 * to the {@link aggregateWeakAreaBuckets} logic it validates. Generators draw
 * per-question outcomes over a small `subjectId`/`topicKey` pool with varied
 * outcomes (including UNANSWERED) and mistake entries with varied categories and
 * optional `topicKey`. The test independently recomputes the expected per-bucket
 * attempted/incorrect counts and per-`Mistake_Category` counts (Subject buckets
 * keyed by `subjectId`; Topic buckets keyed by `topicKey` for rows that carry
 * one) and the expected set of included buckets, then asserts the module's
 * buckets match on both counts and membership/exclusion.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { QuestionOutcome } from '../../lib/scoring/score';
import {
    aggregateWeakAreaBuckets,
    MISTAKE_CATEGORIES,
    type MistakeCategory,
    type MistakeCounts,
    type WeakAreaLevel,
    type WeakAreaMistakeRow,
    type WeakAreaOutcomeRow,
} from './weakArea';

// Run the full validation count regardless of the lighter global default (vitest.setup.ts).
const NUM_RUNS = Math.max(100, Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10) || 0);

// Small pools so subjects and topics collide across many rows, exercising real aggregation.
const SUBJECT_IDS = ['subj-A', 'subj-B', 'subj-C'];
const TOPIC_KEYS = ['topic-1', 'topic-2', 'topic-3', 'topic-4'];

const arbOutcome: fc.Arbitrary<QuestionOutcome> = fc.constantFrom(
    QuestionOutcome.CORRECT,
    QuestionOutcome.INCORRECT,
    QuestionOutcome.UNANSWERED,
);

// An outcome row over the small subject pool; topicKey is present roughly two-thirds of the
// time so both Subject-only and Subject+Topic contributions arise.
const arbOutcomeRow: fc.Arbitrary<WeakAreaOutcomeRow> = fc.record({
    subjectId: fc.constantFrom(...SUBJECT_IDS),
    topicKey: fc.option(fc.constantFrom(...TOPIC_KEYS), { nil: null, freq: 2 }),
    outcome: arbOutcome,
});

// A mistake row with a varied category and optional topicKey.
const arbMistakeRow: fc.Arbitrary<WeakAreaMistakeRow> = fc.record({
    subjectId: fc.constantFrom(...SUBJECT_IDS),
    topicKey: fc.option(fc.constantFrom(...TOPIC_KEYS), { nil: null, freq: 2 }),
    category: fc.constantFrom<MistakeCategory>(...MISTAKE_CATEGORIES),
});

interface ExpectedBucket {
    attemptedCount: number;
    incorrectCount: number;
    correctCount: number;
    mistakeCounts: MistakeCounts;
    // A bucket survives exclusion (Req 11.4) iff it saw an outcome row OR a mistake row.
    hasOutcome: boolean;
    hasMistake: boolean;
}

function emptyMistakeCounts(): MistakeCounts {
    const counts = {} as MistakeCounts;
    for (const category of MISTAKE_CATEGORIES) {
        counts[category] = 0;
    }
    return counts;
}

function bucketId(level: WeakAreaLevel, key: string): string {
    return `${level}\u0000${key}`;
}

describe('weak-area derivation properties', () => {
    // Feature: performance-analytics, Property 14: For any set of per-question outcomes and
    // mistake entries, each level's (Subject keyed by subjectId, Topic keyed by topicKey for
    // rows carrying one) buckets aggregate the attempted/incorrect/correct counts and per-
    // Mistake_Category counts of their constituent inputs, and a Subject/Topic is included iff
    // it has at least one attempt outcome OR at least one mistake entry.
    it('Property 14: weak-area derivation, category counts, and exclusion (Req 11.1, 11.2, 11.4)', () => {
        fc.assert(
            fc.property(
                fc.array(arbOutcomeRow, { maxLength: 40 }),
                fc.array(arbMistakeRow, { maxLength: 40 }),
                (outcomes, mistakes) => {
                    // ── Independently compute the expected buckets ──────────────────────
                    const expected = new Map<string, ExpectedBucket>();

                    const ensure = (level: WeakAreaLevel, key: string): ExpectedBucket => {
                        const id = bucketId(level, key);
                        let bucket = expected.get(id);
                        if (bucket === undefined) {
                            bucket = {
                                attemptedCount: 0,
                                incorrectCount: 0,
                                correctCount: 0,
                                mistakeCounts: emptyMistakeCounts(),
                                hasOutcome: false,
                                hasMistake: false,
                            };
                            expected.set(id, bucket);
                        }
                        return bucket;
                    };

                    const foldOutcome = (bucket: ExpectedBucket, outcome: QuestionOutcome): void => {
                        bucket.hasOutcome = true;
                        if (outcome === QuestionOutcome.CORRECT) {
                            bucket.attemptedCount += 1;
                            bucket.correctCount += 1;
                        } else if (outcome === QuestionOutcome.INCORRECT) {
                            bucket.attemptedCount += 1;
                            bucket.incorrectCount += 1;
                        }
                        // UNANSWERED keeps the bucket alive but is not "attempted".
                    };

                    for (const row of outcomes) {
                        foldOutcome(ensure('SUBJECT', row.subjectId), row.outcome);
                        if (row.topicKey != null) {
                            foldOutcome(ensure('TOPIC', row.topicKey), row.outcome);
                        }
                    }

                    for (const row of mistakes) {
                        const subject = ensure('SUBJECT', row.subjectId);
                        subject.hasMistake = true;
                        subject.mistakeCounts[row.category] += 1;
                        if (row.topicKey != null) {
                            const topic = ensure('TOPIC', row.topicKey);
                            topic.hasMistake = true;
                            topic.mistakeCounts[row.category] += 1;
                        }
                    }

                    // Every bucket the test created arose from a real outcome or mistake row,
                    // so all of them are expected to survive exclusion (Req 11.4).
                    const expectedSurviving = [...expected.entries()].filter(
                        ([, b]) => b.hasOutcome || b.hasMistake,
                    );
                    expect(expectedSurviving.length).toBe(expected.size);

                    // ── Actual module output ────────────────────────────────────────────
                    const actual = aggregateWeakAreaBuckets(outcomes, mistakes);
                    const actualById = new Map(
                        actual.map((b) => [bucketId(b.level, b.key), b]),
                    );

                    // ── Membership / exclusion: exactly the expected buckets, no more ────
                    expect(actual.length).toBe(expectedSurviving.length);
                    expect(actualById.size).toBe(actual.length); // no duplicate (level,key)

                    const actualKeys = [...actualById.keys()].sort();
                    const expectedKeys = expectedSurviving.map(([id]) => id).sort();
                    expect(actualKeys).toEqual(expectedKeys);

                    // ── Per-bucket count aggregation (Req 11.1, 11.2) ───────────────────
                    for (const [id, exp] of expectedSurviving) {
                        const got = actualById.get(id);
                        expect(got).toBeDefined();
                        if (got === undefined) continue;

                        expect(got.attemptedCount).toBe(exp.attemptedCount);
                        expect(got.incorrectCount).toBe(exp.incorrectCount);
                        expect(got.correctCount).toBe(exp.correctCount);
                        expect(got.mistakeCounts).toEqual(exp.mistakeCounts);

                        // attempted = correct + incorrect (UNANSWERED excluded).
                        expect(got.attemptedCount).toBe(got.correctCount + got.incorrectCount);
                    }
                },
            ),
            { numRuns: NUM_RUNS },
        );
    });
});
