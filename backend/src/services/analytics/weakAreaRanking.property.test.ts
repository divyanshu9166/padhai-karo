/**
 * Property-based test for the pure weak-area ranking + tiebreak logic
 * (task 11.5, design "Weak-area detection, scoring & ranking" step 6 and the
 * "Weak-Area endpoint" ordering contract).
 *
 *   - Property 16 (task 11.5): weak-area ranking and tiebreak (Req 12.1, 12.3).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed next
 * to the {@link rankWeakAreas} logic it validates, mirroring the fast-check +
 * vitest convention of the other `*.property.test.ts` modules in this codebase
 * (see `topicTrend.property.test.ts`).
 *
 * The generator produces arbitrary {@link WeakAreaBucket} arrays with varied
 * `incorrectCount` / `attemptedCount` / `mistakeCounts` so a wide spread of
 * `weakAreaScore`s — and genuine ties — both arise. Ties are forced two ways:
 *   (a) duplicate buckets with *identical* scoring inputs (same attempted /
 *       incorrect / mistakeCounts ⇒ identical score AND identical incorrectCount), and
 *   (b) "dyadic" tie-groups that share an exactly-equal score but DIFFER in
 *       `incorrectCount` — built by holding `mistakeCounts` fixed and scaling a
 *       fixed error ratio `num/d` (with `d` a power of two, so `num/d` is exactly
 *       representable) by varying integer factors, giving
 *       `errorRate = (num*s)/(d*s) === num/d` for every factor `s`. This exercises
 *       the differentiating branch of the `incorrectCount`-descending tiebreak.
 *
 * The property then asserts the ordering contract directly: for every adjacent
 * pair the score is non-increasing (Req 12.1) and, when two adjacent entries have
 * an exactly-equal score, the earlier one has the greater-or-equal incorrectCount
 * (Req 12.3). Equality is checked with `===` to match the implementation's own
 * tie detection.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    MISTAKE_CATEGORIES,
    rankWeakAreas,
    type MistakeCounts,
    type WeakAreaBucket,
    type WeakAreaLevel,
} from './weakArea';

// Run the full validation count regardless of the lighter global default (vitest.setup.ts).
const NUM_RUNS = Math.max(100, Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10) || 0);

// A complete per-`Mistake_Category` count record (every category present), so the
// generated buckets match the shape the derivation produces.
const arbMistakeCounts: fc.Arbitrary<MistakeCounts> = fc
    .tuple(...MISTAKE_CATEGORIES.map(() => fc.nat({ max: 8 })))
    .map((counts) => {
        const record = {} as MistakeCounts;
        MISTAKE_CATEGORIES.forEach((category, i) => {
            record[category] = counts[i];
        });
        return record;
    });

const arbLevel: fc.Arbitrary<WeakAreaLevel> = fc.constantFrom('SUBJECT', 'TOPIC');

// A general, arbitrary bucket: `incorrectCount <= attemptedCount` (as the real
// derivation guarantees), `correctCount = attempted - incorrect`, and an arbitrary
// mistake-count record — so scores span a wide range with incidental ties.
const arbGeneralBucket: fc.Arbitrary<WeakAreaBucket> = fc
    .tuple(
        arbLevel,
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
        fc.nat({ max: 20 }),
        fc.nat({ max: 20 }),
        arbMistakeCounts,
    )
    .map(([level, key, name, a, b, mistakeCounts]) => {
        const attemptedCount = Math.max(a, b);
        const incorrectCount = Math.min(a, b);
        return {
            level,
            key,
            name,
            attemptedCount,
            incorrectCount,
            correctCount: attemptedCount - incorrectCount,
            mistakeCounts,
        };
    });

// A deliberate tie-group: every bucket shares an exactly-equal `weakAreaScore`
// (same error ratio `num/d` with `d` a power of two ⇒ exact float, plus identical
// `mistakeCounts`) but DIFFERS in `incorrectCount` because each member scales the
// ratio by a distinct integer factor. With `num > 0` and ≥2 distinct factors the
// group contains equal-score buckets with different incorrectCounts, exercising the
// tiebreak's differentiating branch. (When `num = 0` every member has
// incorrectCount 0 — still a valid equal-score, equal-incorrect tie.)
const arbTieGroup: fc.Arbitrary<WeakAreaBucket[]> = fc
    .record({
        d: fc.constantFrom(1, 2, 4, 8),
        level: arbLevel,
        mistakeCounts: arbMistakeCounts,
        factors: fc.uniqueArray(fc.integer({ min: 1, max: 6 }), { minLength: 1, maxLength: 4 }),
        numRaw: fc.nat({ max: 8 }),
    })
    .map(({ d, level, mistakeCounts, factors, numRaw }) => {
        const num = numRaw % (d + 1); // 0 <= num <= d, so errorRate = num/d in [0, 1]
        return factors.map((s, i) => {
            const attemptedCount = d * s;
            const incorrectCount = num * s;
            return {
                level,
                key: `tie-${d}-${num}-${i}`,
                name: null,
                attemptedCount,
                incorrectCount,
                correctCount: attemptedCount - incorrectCount,
                // Fresh copy per bucket so no two buckets share a reference.
                mistakeCounts: { ...mistakeCounts },
            } satisfies WeakAreaBucket;
        });
    });

// Also include exact-duplicate buckets (identical scoring inputs) per the task's
// "include buckets with identical scoring inputs" guidance.
const arbDuplicatePair: fc.Arbitrary<WeakAreaBucket[]> = arbGeneralBucket.map((bucket) => [
    bucket,
    { ...bucket, key: `${bucket.key}-dup`, mistakeCounts: { ...bucket.mistakeCounts } },
]);

// The full bucket set: a mix of general buckets, dyadic tie-groups, and exact
// duplicates, flattened into a single array (order is irrelevant — ranking sorts).
const arbBuckets: fc.Arbitrary<WeakAreaBucket[]> = fc
    .tuple(
        fc.array(arbGeneralBucket, { maxLength: 12 }),
        fc.array(arbTieGroup, { maxLength: 4 }),
        fc.array(arbDuplicatePair, { maxLength: 3 }),
    )
    .map(([general, tieGroups, dupPairs]) => [
        ...general,
        ...tieGroups.flat(),
        ...dupPairs.flat(),
    ]);

describe('weak-area ranking properties', () => {
    // Feature: performance-analytics, Property 16: For any derived set of weak areas, the
    // ranked result is ordered non-increasing by weakAreaScore (Req 12.1), and any two areas
    // with an equal weakAreaScore are ordered by incorrectCount descending (Req 12.3).
    it('Property 16: weak-area ranking and tiebreak (Req 12.1, 12.3)', () => {
        fc.assert(
            fc.property(arbBuckets, (buckets) => {
                const ranked = rankWeakAreas(buckets);

                // Ranking neither drops nor invents entries.
                expect(ranked.length).toBe(buckets.length);

                for (let i = 1; i < ranked.length; i += 1) {
                    const prev = ranked[i - 1];
                    const next = ranked[i];

                    // ── Primary order: non-increasing by weakAreaScore (Req 12.1) ────────
                    expect(prev.weakAreaScore).toBeGreaterThanOrEqual(next.weakAreaScore);

                    // ── Tiebreak: equal score ⇒ incorrectCount descending (Req 12.3) ─────
                    // Use `===` to match the implementation's own tie detection.
                    if (prev.weakAreaScore === next.weakAreaScore) {
                        expect(prev.incorrectCount).toBeGreaterThanOrEqual(next.incorrectCount);
                    }
                }
            }),
            { numRuns: NUM_RUNS },
        );
    });
});
