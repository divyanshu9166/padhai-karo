/**
 * Pure topic-prioritization combination, flagging, and ordering (task 12.1;
 * design "Topic prioritization (Req 8)" and the Topic Prioritization endpoint;
 * Req 8.1, 8.2, 8.3, 8.4, 12.2).
 *
 * The Topic Prioritization output fuses two independent signals into a single
 * triage ranking: how often a Topic appears in past papers (the dataset signal,
 * `avgQuestionsPerYear` from the active Topic_Frequency_Reference_Data) and how
 * much the user struggles with it (the user signal, the per-Topic
 * `weakAreaScore` produced by weak-area detection). The result tells the user
 * where effort pays off most — high-yield topics that are also personal
 * weaknesses (Req 8.1).
 *
 * Following the Phase 1 layering convention (see `topicTrend.ts`,
 * `weakArea.ts`, `trajectory.ts`, `lib/scoring/score.ts`), this module:
 *   - imports no Prisma client and no framework code,
 *   - accepts already-read plain rows (the thin service handler, task 20.1,
 *     reads the active topic frequencies and obtains the per-Topic
 *     `weakAreaScore` map from the weak-area service and passes them in),
 *   - never mutates its inputs (returns a new array of new objects),
 *   - is the property-test surface for topic-prioritization behavior
 *     (task 12.2, Property 10).
 *
 * ── Input shape (documented choice) ───────────────────────────────────────────
 * The frequency input is a minimal structural `{ topicKey, topicName,
 * avgQuestionsPerYear }` list ({@link TopicFrequencyInput}). This is a strict
 * subset of the `TopicTrend` shape emitted by `topicTrend.ts`, so task 20.1 can
 * pass `TopicTrend[]` directly without adaptation. The topic *universe* is
 * exactly the frequency input: one {@link TopicPriority} is produced per input
 * topic, in line with the topic-trend universe being the track chapter catalog.
 * The per-Topic weak-area scores arrive as a `Record<topicKey, number>` exactly
 * as `buildWeakAreaScoreByTopic` (in `weakArea.ts`) produces it (Req 12.2); a
 * topic absent from that map has an effective `weakAreaScore` of `0`.
 *
 * ── Combination & normalization (Req 8.1, 8.4) ────────────────────────────────
 *   priority = WFREQ * norm(avgQuestionsPerYear) + WWEAK * norm(weakAreaScore)
 *
 * where `norm` min-max-scales a component to `[0, 1]` over the *current topic
 * set* (so prioritization is relative to the topics in play, not an absolute
 * scale). The fixed weights {@link TOPIC_PRIORITY_WEIGHTS} sum to `1`, so with
 * both normalized terms in `[0, 1]` the resulting `priority` is itself in
 * `[0, 1]`.
 *
 * Degenerate normalization case: when every value in a component is equal
 * (`max === min`) — which includes the single-topic case and, crucially, the
 * all-zero case — there is no spread to scale against, so `norm` returns `0` for
 * every topic in that component. This is what makes the no-weak-areas fallback
 * fall out for free (Req 8.4): with an empty/all-zero weak-area map every
 * `weakAreaScore` is `0`, so `norm(weakAreaScore) = 0` for all topics and
 * `priority` reduces to `WFREQ * norm(avgQuestionsPerYear)` — i.e. the ordering
 * by priority equals the ordering by normalized frequency alone. (Likewise, if
 * every topic shares one frequency value, the frequency term contributes a flat
 * `0` and ordering is driven by the weak-area term.)
 *
 * ── High-frequency-and-weak flag (Req 8.3) ────────────────────────────────────
 * A topic is flagged `isHighFreqAndWeak = true` iff BOTH:
 *   - its `avgQuestionsPerYear >= HIGH_FREQUENCY_THRESHOLD` (a dataset-level
 *     threshold on the *raw* average, not the normalized value — the threshold
 *     is an absolute "this topic is high-yield" judgment), AND
 *   - it appears among the user's weak areas, taken here to mean it has a
 *     strictly positive `weakAreaScore` in the map. A topic absent from the map,
 *     or present with a `0` score (e.g. a bucket kept alive only by unanswered
 *     questions), is not "weak" and is not flagged.
 *
 * The flag is computed from the raw inputs and is therefore independent of the
 * relative normalization, so it is stable regardless of which other topics are
 * present in the set.
 *
 * ── Ordering (Req 8.2) ────────────────────────────────────────────────────────
 * The result is sorted by `priority` descending. Ties break by `topicName`
 * ascending, matching the stable, input-order-independent tiebreak used by
 * `topicTrend.ts`.
 */

/**
 * One topic's frequency signal, as needed for prioritization. Deliberately a
 * minimal structural subset of `TopicTrend` (see `topicTrend.ts`) so the
 * service (task 20.1) can pass `TopicTrend[]` directly. Plain DB-free shape.
 */
export interface TopicFrequencyInput {
    /** == Phase 1 `Chapter.referenceKey` — the Topic key; joins to the weak-area map. */
    topicKey: string;
    /** Human-readable Topic (chapter) name; the deterministic tiebreak key. */
    topicName: string;
    /** Average questions per year from the active Topic_Frequency_Reference_Data. */
    avgQuestionsPerYear: number;
}

/**
 * A single prioritized Topic (design Topic Prioritization endpoint:
 * `TopicPriority = { topicKey, topicName, avgQuestionsPerYear, weakAreaScore,
 * priority, isHighFreqAndWeak }`).
 */
export interface TopicPriority {
    topicKey: string;
    topicName: string;
    /** The raw `avgQuestionsPerYear` carried through from the frequency input. */
    avgQuestionsPerYear: number;
    /** The user's per-Topic `weakAreaScore` (`0` when absent from the map). */
    weakAreaScore: number;
    /** Combined priority in `[0, 1]`: `WFREQ*norm(freq) + WWEAK*norm(weakArea)`. */
    priority: number;
    /** `true` iff high-frequency (raw threshold) AND a positive weak-area score (Req 8.3). */
    isHighFreqAndWeak: boolean;
}

/**
 * Dataset-level high-frequency threshold on the *raw* `avgQuestionsPerYear`
 * (Req 8.3). A Topic averaging at least this many questions per year is
 * considered high-yield. JEE/NEET topics typically average roughly 1–4
 * questions per year, so a threshold of `2` selects the genuinely
 * above-typical-yield topics as the "high-frequency" half of the combined flag.
 * Exported so the service and the property test reference the same constant.
 */
export const HIGH_FREQUENCY_THRESHOLD = 2;

/**
 * Fixed relative weights of the two priority components (Req 8.1). They sum to
 * `1`, so with both normalized terms in `[0, 1]` the combined `priority` stays
 * in `[0, 1]`. Frequency and weak-area signals are weighted equally: the entire
 * purpose of the combined ranking is the *intersection* of "high-yield" and
 * "personal weakness", so neither signal dominates the other.
 */
export const TOPIC_PRIORITY_WEIGHTS = {
    /** `WFREQ`: weight on `norm(avgQuestionsPerYear)`. */
    frequency: 0.5,
    /** `WWEAK`: weight on `norm(weakAreaScore)`. */
    weakArea: 0.5,
} as const;

/**
 * Build a min-max normalizer over `values`, scaling each into `[0, 1]`.
 *
 * Returns a function `norm(x) = (x - min) / (max - min)`. In the degenerate case
 * where every value is equal (`max === min`) — which covers the single-value and
 * all-zero cases — there is no spread, so the normalizer returns `0` for every
 * input (documented above; this is what yields the Req 8.4 fallback). The
 * returned closure does not depend on the order of `values`.
 */
function makeMinMaxNormalizer(values: readonly number[]): (value: number) => number {
    if (values.length === 0) {
        return () => 0;
    }
    let min = values[0];
    let max = values[0];
    for (const value of values) {
        if (value < min) {
            min = value;
        }
        if (value > max) {
            max = value;
        }
    }
    const range = max - min;
    if (range === 0) {
        return () => 0;
    }
    return (value: number) => (value - min) / range;
}

/**
 * Compute the prioritized Topic ranking from already-read topic frequencies and
 * the per-Topic `weakAreaScore` map (Req 8.1, 8.2, 8.3, 8.4, 12.2).
 *
 * For each input topic: look up its `weakAreaScore` (defaulting to `0` when the
 * topic is absent from the map), compute `priority = WFREQ*norm(freq) +
 * WWEAK*norm(weakArea)` with both components normalized over the current topic
 * set, and flag `isHighFreqAndWeak` per the raw-threshold-and-positive-score
 * rule. The output is one {@link TopicPriority} per input topic, ordered
 * descending by `priority` with a stable `topicName`-ascending tiebreak.
 *
 * Pure: performs no I/O, builds and returns a new array of new objects, and
 * mutates neither `topicFrequencies` nor `weakAreaScoreByTopic`.
 *
 * @param topicFrequencies The current topic set with their `avgQuestionsPerYear`
 *   (a `TopicTrend[]` is structurally accepted; see {@link TopicFrequencyInput}).
 * @param weakAreaScoreByTopic Per-Topic `weakAreaScore` map keyed by `topicKey`,
 *   as produced by weak-area detection (`buildWeakAreaScoreByTopic`); an empty
 *   map represents a user with no weak areas (Req 8.4).
 */
export function prioritizeTopics(
    topicFrequencies: readonly TopicFrequencyInput[],
    weakAreaScoreByTopic: Readonly<Record<string, number>>,
): TopicPriority[] {
    const weakAreaScores = topicFrequencies.map(
        (topic) => weakAreaScoreByTopic[topic.topicKey] ?? 0,
    );

    const normFrequency = makeMinMaxNormalizer(
        topicFrequencies.map((topic) => topic.avgQuestionsPerYear),
    );
    const normWeakArea = makeMinMaxNormalizer(weakAreaScores);

    const prioritized = topicFrequencies.map((topic, index) => {
        const weakAreaScore = weakAreaScores[index];
        const priority =
            TOPIC_PRIORITY_WEIGHTS.frequency * normFrequency(topic.avgQuestionsPerYear) +
            TOPIC_PRIORITY_WEIGHTS.weakArea * normWeakArea(weakAreaScore);
        const isHighFreqAndWeak =
            topic.avgQuestionsPerYear >= HIGH_FREQUENCY_THRESHOLD && weakAreaScore > 0;

        return {
            topicKey: topic.topicKey,
            topicName: topic.topicName,
            avgQuestionsPerYear: topic.avgQuestionsPerYear,
            weakAreaScore,
            priority,
            isHighFreqAndWeak,
        };
    });

    prioritized.sort((a, b) => {
        if (b.priority !== a.priority) {
            return b.priority - a.priority;
        }
        return a.topicName.localeCompare(b.topicName);
    });

    return prioritized;
}
