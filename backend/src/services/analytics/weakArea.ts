/**
 * Pure weak-area derivation, mistake-category folding, empty-bucket exclusion,
 * and per-Session_Type study-time distribution (task 11.1; design "Weak-area
 * detection, scoring & ranking" steps 1–4 and 8; Req 11.1, 11.2, 11.3, 11.4,
 * 11.5).
 *
 * Like the other Analytics_Service pure modules (`attemptQuality.ts`,
 * `trajectory.ts`) and the Phase 1 `lib/scoring/score.ts`, this module is
 * intentionally free of any database, Prisma, or framework dependency. It
 * receives rows that the service layer has ALREADY read and joined — each
 * per-question outcome already resolved to its `subjectId` (via `PYQ`) and,
 * when available, its `topicKey` (via `QuestionTopicMap`) — and returns plain
 * results. Because it is database-free and operates on already-read rows it
 * structurally cannot write, and it never mutates its inputs (Req 11.5; the
 * no-mutation Property 12 / task 13.1 tests this).
 *
 * What this module implements now (task 11.1):
 *   1. Aggregate per-question outcomes at the Subject level (keyed by
 *      `subjectId`, always derivable) and the Chapter/Topic level (keyed by
 *      `topicKey`, only formed for questions that carry a `topicKey`). Because
 *      Phase 1 records chapter-granularity reference keys and the glossary makes
 *      `topicKey == Chapter.referenceKey == Topic key`, Chapter and Topic share
 *      a single keyspace and are emitted as one `TOPIC`-level bucket per
 *      `topicKey` (design "Topic granularity and question→topic mapping").
 *   2. Track, per bucket, `attemptedCount`, `incorrectCount`, and `correctCount`
 *      (a question is "attempted" when its outcome is CORRECT or INCORRECT;
 *      UNANSWERED outcomes still keep the bucket alive but are not "attempted").
 *   3. Fold in per-`Mistake_Category` counts per bucket from mistake-journal
 *      rows (Req 11.2).
 *   4. Exclude any Subject/Chapter/Topic bucket that has no attempt outcomes AND
 *      no mistake entries (Req 11.4) — achieved structurally, since a bucket is
 *      only ever created from a real outcome or mistake row.
 *   5. Compute the per-`Session_Type` study-time distribution by summing
 *      `FocusSession.focusedDurationMin` grouped by `sessionType` (Req 11.3).
 *
 * Deferred to task 11.2 (clearly marked extension point at the end of this
 * file): computing each bucket's `weakAreaScore` from its error rate + weighted
 * mistake counts, ranking buckets descending by score (tie-broken by
 * `incorrectCount`), and exposing the per-Topic `weakAreaScore` map consumed by
 * topic prioritization (Req 12.1, 12.2, 12.3).
 */

import { QuestionOutcome } from '../../lib/scoring/score';

/**
 * The four `Mistake_Category` values, mirroring the Prisma `MistakeCategory`
 * enum. Declared locally (rather than importing the generated client) so this
 * module stays database-free, matching the `QuestionOutcome` mirroring in
 * `lib/scoring/score.ts`. The order is the canonical declaration order used for
 * deterministic, complete `mistakeCounts` records.
 */
export const MISTAKE_CATEGORIES = [
    'SILLY_MISTAKE',
    'CONCEPT_GAP',
    'TIME_PRESSURE',
    'NEVER_SEEN_THIS',
] as const;

export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

/**
 * The five `Session_Type` values, mirroring the Prisma `SessionType` enum. Kept
 * local for the same database-free reason as {@link MISTAKE_CATEGORIES}; the
 * order is the canonical one used to order the session-type distribution
 * deterministically.
 */
export const SESSION_TYPES = [
    'NEW_CHAPTER',
    'PRACTICE_PROBLEMS',
    'REVISION',
    'MOCK_ANALYSIS',
    'FORMULA_DRILL',
] as const;

export type SessionType = (typeof SESSION_TYPES)[number];

/**
 * The level at which a weak area is aggregated. Subject-level areas are always
 * derivable (every input row carries a `subjectId`); Chapter/Topic-level areas
 * are derivable only for questions with a `topicKey`. Since `topicKey` is the
 * Phase 1 `Chapter.referenceKey` and also serves as the Topic key, Chapter and
 * Topic collapse to a single `TOPIC`-level bucket per `topicKey`.
 */
export type WeakAreaLevel = 'SUBJECT' | 'TOPIC';

/**
 * One already-joined per-question outcome from a `PYQAttempt` or
 * `TimedPaperAttempt`. The service layer resolves `subjectId` (via `PYQ`) and
 * `topicKey` (via `QuestionTopicMap`) before passing rows in. A row with a
 * null/undefined `topicKey` contributes only at the Subject level. Optional
 * display names are carried through so the bucket can be labeled without a
 * second join; they are not required for derivation.
 */
export interface WeakAreaOutcomeRow {
    subjectId: string;
    subjectName?: string | null;
    topicKey?: string | null;
    topicName?: string | null;
    outcome: QuestionOutcome;
}

/**
 * One already-joined `MistakeJournalEntry`, resolved to its `subjectId` and
 * (when available) `topicKey`, carrying its `Mistake_Category`. A row without a
 * `topicKey` folds in only at the Subject level.
 */
export interface WeakAreaMistakeRow {
    subjectId: string;
    subjectName?: string | null;
    topicKey?: string | null;
    topicName?: string | null;
    category: MistakeCategory;
}

/**
 * One already-read `FocusSession`, reduced to the fields needed for the
 * per-Session_Type study-time distribution (Req 11.3).
 */
export interface WeakAreaFocusSessionRow {
    sessionType: SessionType;
    focusedDurationMin: number;
}

/** A complete per-`Mistake_Category` count record (every category present). */
export type MistakeCounts = Record<MistakeCategory, number>;

/**
 * An intermediate weak-area bucket produced by derivation. Task 11.2 extends
 * each bucket with a `weakAreaScore` and ranks them; this shape carries
 * everything that scoring needs:
 *
 * - `attemptedCount` — answered questions (CORRECT or INCORRECT) in the bucket.
 * - `incorrectCount` — INCORRECT questions; the tiebreak key for ranking.
 * - `correctCount`   — CORRECT questions.
 * - `mistakeCounts`  — per-`Mistake_Category` counts folded in from the journal.
 *
 * `name` is the display label resolved from the input rows when available, else
 * `null`. `key` is the `subjectId` for SUBJECT buckets and the `topicKey` for
 * TOPIC buckets.
 */
export interface WeakAreaBucket {
    level: WeakAreaLevel;
    key: string;
    name: string | null;
    attemptedCount: number;
    incorrectCount: number;
    correctCount: number;
    mistakeCounts: MistakeCounts;
}

/** A per-`Session_Type` focused-study-time total (Req 11.3). */
export interface SessionTypeStudyTime {
    sessionType: SessionType;
    totalMinutes: number;
}

/** The complete DB-free input to weak-area derivation. */
export interface WeakAreaDerivationInput {
    outcomes: ReadonlyArray<WeakAreaOutcomeRow>;
    mistakes: ReadonlyArray<WeakAreaMistakeRow>;
    focusSessions: ReadonlyArray<WeakAreaFocusSessionRow>;
}

/**
 * The derivation result consumed by task 11.2 (scoring/ranking) and by the
 * weak-area service. `buckets` are the surviving (non-empty) Subject and
 * Chapter/Topic buckets in a deterministic order; `sessionTypeDistribution` is
 * the per-Session_Type focused-minutes total.
 */
export interface WeakAreaDerivation {
    buckets: WeakAreaBucket[];
    sessionTypeDistribution: SessionTypeStudyTime[];
}

/** Build a zeroed, complete per-`Mistake_Category` count record. */
function emptyMistakeCounts(): MistakeCounts {
    const counts = {} as MistakeCounts;
    for (const category of MISTAKE_CATEGORIES) {
        counts[category] = 0;
    }
    return counts;
}

/**
 * Get-or-create the bucket for `(level, key)` in `byKey`, preferring the first
 * non-null `name` seen for that bucket. Buckets are only ever created here, from
 * a real outcome or mistake row, which is what structurally enforces the
 * empty-bucket exclusion of Req 11.4.
 */
function getOrCreateBucket(
    byKey: Map<string, WeakAreaBucket>,
    level: WeakAreaLevel,
    key: string,
    name: string | null | undefined,
): WeakAreaBucket {
    const mapKey = `${level}\u0000${key}`;
    let bucket = byKey.get(mapKey);
    if (bucket === undefined) {
        bucket = {
            level,
            key,
            name: name ?? null,
            attemptedCount: 0,
            incorrectCount: 0,
            correctCount: 0,
            mistakeCounts: emptyMistakeCounts(),
        };
        byKey.set(mapKey, bucket);
    } else if (bucket.name === null && name != null) {
        bucket.name = name;
    }
    return bucket;
}

/** Fold one outcome into a bucket's attempted/incorrect/correct counts. */
function addOutcome(bucket: WeakAreaBucket, outcome: QuestionOutcome): void {
    if (outcome === QuestionOutcome.CORRECT) {
        bucket.attemptedCount += 1;
        bucket.correctCount += 1;
    } else if (outcome === QuestionOutcome.INCORRECT) {
        bucket.attemptedCount += 1;
        bucket.incorrectCount += 1;
    }
    // UNANSWERED outcomes keep the bucket alive (it has an attempt outcome, so
    // it is not excluded by Req 11.4) but do not count as "attempted".
}

/**
 * Aggregate per-question outcomes and fold in mistake-category counts at the
 * Subject level (keyed by `subjectId`) and the Chapter/Topic level (keyed by
 * `topicKey`, only for rows that carry one), excluding any bucket with no
 * attempt outcomes and no mistake entries (Req 11.1, 11.2, 11.4).
 *
 * Read-only: never mutates the input rows (it only reads their fields).
 *
 * Buckets are returned grouped by level (SUBJECT before TOPIC) and, within a
 * level, sorted by `key` for deterministic output. Task 11.2 re-orders the
 * surviving buckets by `weakAreaScore`.
 */
export function aggregateWeakAreaBuckets(
    outcomes: ReadonlyArray<WeakAreaOutcomeRow>,
    mistakes: ReadonlyArray<WeakAreaMistakeRow>,
): WeakAreaBucket[] {
    const byKey = new Map<string, WeakAreaBucket>();

    for (const row of outcomes) {
        const subjectBucket = getOrCreateBucket(byKey, 'SUBJECT', row.subjectId, row.subjectName);
        addOutcome(subjectBucket, row.outcome);

        if (row.topicKey != null) {
            const topicBucket = getOrCreateBucket(byKey, 'TOPIC', row.topicKey, row.topicName);
            addOutcome(topicBucket, row.outcome);
        }
    }

    for (const row of mistakes) {
        const subjectBucket = getOrCreateBucket(byKey, 'SUBJECT', row.subjectId, row.subjectName);
        subjectBucket.mistakeCounts[row.category] += 1;

        if (row.topicKey != null) {
            const topicBucket = getOrCreateBucket(byKey, 'TOPIC', row.topicKey, row.topicName);
            topicBucket.mistakeCounts[row.category] += 1;
        }
    }

    // Only buckets created from real rows exist, so every bucket already has at
    // least one attempt outcome or mistake entry (Req 11.4). Order
    // deterministically: SUBJECT level first, then TOPIC, each sorted by key.
    const levelOrder: Record<WeakAreaLevel, number> = { SUBJECT: 0, TOPIC: 1 };
    return [...byKey.values()].sort((a, b) => {
        if (a.level !== b.level) {
            return levelOrder[a.level] - levelOrder[b.level];
        }
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
}

/**
 * Compute the per-`Session_Type` study-time distribution by summing
 * `focusedDurationMin` grouped by `sessionType` (Req 11.3). Total minutes are
 * conserved with no double counting: each session contributes to exactly one
 * session-type bucket. Only session types that actually occur are returned, in
 * the canonical {@link SESSION_TYPES} order for deterministic output.
 *
 * Read-only: never mutates the input rows.
 */
export function computeSessionTypeDistribution(
    focusSessions: ReadonlyArray<WeakAreaFocusSessionRow>,
): SessionTypeStudyTime[] {
    const totals = new Map<SessionType, number>();
    for (const session of focusSessions) {
        const previous = totals.get(session.sessionType) ?? 0;
        totals.set(session.sessionType, previous + session.focusedDurationMin);
    }

    return SESSION_TYPES.filter((sessionType) => totals.has(sessionType)).map((sessionType) => ({
        sessionType,
        totalMinutes: totals.get(sessionType) as number,
    }));
}

/**
 * Derive weak-area buckets (with mistake-category counts and empty-bucket
 * exclusion) and the per-Session_Type study-time distribution from already-read
 * Phase 1 rows (Req 11.1–11.4). Read-only over its inputs (Req 11.5).
 *
 * The returned `buckets` are NOT yet scored or ranked; that is task 11.2 (see
 * the extension point below).
 */
export function deriveWeakAreas(input: WeakAreaDerivationInput): WeakAreaDerivation {
    return {
        buckets: aggregateWeakAreaBuckets(input.outcomes, input.mistakes),
        sessionTypeDistribution: computeSessionTypeDistribution(input.focusSessions),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring, ranking & per-Topic score map — task 11.2 (design steps 5–7;
// Req 12.1, 12.2, 12.3). This section extends — and does not alter — the
// derivation, category folding, empty-bucket exclusion, and session-type
// distribution above. Everything here is pure and database-free, and never
// mutates its inputs: scoring reads bucket fields and produces fresh
// `ScoredWeakArea` objects, leaving the source {@link WeakAreaBucket}s untouched.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-`Mistake_Category` weights for the mistake component of the weak-area
 * score (design step 5: "Concept Gap and Never Seen This weigh higher than
 * Silly Mistake"). These are deliberate, fixed weights in `[0, 1]`:
 *
 * - `CONCEPT_GAP` and `NEVER_SEEN_THIS` (1.0) — genuine knowledge gaps that most
 *   demand attention, so they weigh the most.
 * - `TIME_PRESSURE` (0.5) — the concept is likely known but execution under time
 *   failed; moderately important.
 * - `SILLY_MISTAKE` (0.25) — careless slips that signal the least underlying
 *   weakness, so they weigh the least (but still non-zero).
 *
 * The maximum single-category weight is `1.0`, which keeps the per-mistake
 * contribution on the same `[0, 1]` scale as the weights themselves.
 */
export const MISTAKE_CATEGORY_WEIGHTS: Readonly<Record<MistakeCategory, number>> = {
    SILLY_MISTAKE: 0.25,
    TIME_PRESSURE: 0.5,
    CONCEPT_GAP: 1.0,
    NEVER_SEEN_THIS: 1.0,
};

/**
 * Saturation constant for normalizing the weighted mistake sum into `[0, 1)`.
 * The raw weighted sum is unbounded (it grows with the number of mistakes), so
 * to combine it with the bounded `errorRate` we map it through the saturating
 * function `s / (s + K)` with `K = MISTAKE_SATURATION`. This is monotonically
 * increasing in the weighted sum (more/heavier mistakes ⇒ strictly higher
 * normalized weight, preserving ranking signal) while staying in `[0, 1)`. At
 * `K` weighted-units the normalized weight is `0.5`. The value was chosen so a
 * handful of concept-level mistakes already pushes the mistake term toward its
 * upper range.
 */
export const MISTAKE_SATURATION = 5;

/**
 * Relative weights of the two weak-area-score components. They sum to `1`, so
 * with both `errorRate` and `normalizedMistakeWeight` in `[0, 1]` the resulting
 * `weakAreaScore` is itself in `[0, 1)`. Error rate is weighted slightly higher
 * than the mistake term because a high proportion of wrong answers is the most
 * direct evidence of a weak area, while the mistake journal is a secondary,
 * self-reported signal.
 */
export const WEAK_AREA_SCORE_WEIGHTS = {
    /** `wErr`: weight on `errorRate`. */
    error: 0.6,
    /** `wMiss`: weight on `normalizedMistakeWeight`. */
    mistake: 0.4,
} as const;

/**
 * A scored weak area — the shape the Weak-Area service/endpoint returns for each
 * ranked area (design "Weak-Area endpoint"; `WeakArea = { level, key, name,
 * weakAreaScore, incorrectCount, attemptedCount, mistakeCounts }`). It carries
 * the derivation fields needed by the response plus the computed
 * `weakAreaScore`. `correctCount` is intentionally dropped here since the
 * endpoint does not surface it.
 */
export interface ScoredWeakArea {
    level: WeakAreaLevel;
    key: string;
    name: string | null;
    weakAreaScore: number;
    incorrectCount: number;
    attemptedCount: number;
    mistakeCounts: MistakeCounts;
}

/**
 * The full scored weak-area result the service (task 23.1) returns and that
 * topic prioritization (task 20.1) consumes:
 *
 * - `weakAreas` — every surviving bucket scored and ranked descending by
 *   `weakAreaScore`, tie-broken by `incorrectCount` descending (Req 12.1, 12.3).
 * - `sessionTypeDistribution` — passed through from derivation (Req 11.3).
 * - `weakAreaScoreByTopic` — the per-Topic `weakAreaScore` map (keyed by
 *   `topicKey`) for topic prioritization (Req 12.2).
 */
export interface ScoredWeakAreaResult {
    weakAreas: ScoredWeakArea[];
    sessionTypeDistribution: SessionTypeStudyTime[];
    weakAreaScoreByTopic: Record<string, number>;
}

/**
 * The error rate of a bucket: `incorrectCount / max(attemptedCount, 1)` (design
 * step 5). The `max(·, 1)` guard keeps the rate at `0` for a bucket with no
 * attempts (e.g. one that exists only because of mistake-journal entries) and
 * otherwise yields a value in `[0, 1]`.
 */
export function weakAreaErrorRate(bucket: WeakAreaBucket): number {
    return bucket.incorrectCount / Math.max(bucket.attemptedCount, 1);
}

/**
 * The weighted sum of a bucket's per-category mistake counts using
 * {@link MISTAKE_CATEGORY_WEIGHTS}. Unbounded above; normalized by
 * {@link normalizedMistakeWeight}.
 */
export function weightedMistakeSum(mistakeCounts: MistakeCounts): number {
    let sum = 0;
    for (const category of MISTAKE_CATEGORIES) {
        sum += MISTAKE_CATEGORY_WEIGHTS[category] * mistakeCounts[category];
    }
    return sum;
}

/**
 * The bucket's mistake component, normalized into `[0, 1)` via the saturating
 * map `s / (s + K)` (`K = {@link MISTAKE_SATURATION}`). Monotonic in the
 * weighted mistake sum and `0` when there are no mistakes.
 */
export function normalizedMistakeWeight(mistakeCounts: MistakeCounts): number {
    const sum = weightedMistakeSum(mistakeCounts);
    return sum / (sum + MISTAKE_SATURATION);
}

/**
 * Compute a bucket's `weakAreaScore` (design step 5):
 *
 *     weakAreaScore = wErr * errorRate + wMiss * normalizedMistakeWeight
 *
 * with `errorRate = incorrectCount / max(attemptedCount, 1)` and
 * `normalizedMistakeWeight` the saturated weighted mistake sum. Both terms are
 * in `[0, 1]` and the weights ({@link WEAK_AREA_SCORE_WEIGHTS}) sum to `1`, so
 * the score is in `[0, 1)`. Higher means more attention needed. Pure: reads the
 * bucket without mutating it.
 */
export function scoreWeakAreaBucket(bucket: WeakAreaBucket): number {
    return (
        WEAK_AREA_SCORE_WEIGHTS.error * weakAreaErrorRate(bucket) +
        WEAK_AREA_SCORE_WEIGHTS.mistake * normalizedMistakeWeight(bucket.mistakeCounts)
    );
}

/**
 * Project a derived {@link WeakAreaBucket} into a scored {@link ScoredWeakArea},
 * attaching its `weakAreaScore`. Returns a fresh object; the input bucket is not
 * mutated.
 */
export function toScoredWeakArea(bucket: WeakAreaBucket): ScoredWeakArea {
    return {
        level: bucket.level,
        key: bucket.key,
        name: bucket.name,
        weakAreaScore: scoreWeakAreaBucket(bucket),
        incorrectCount: bucket.incorrectCount,
        attemptedCount: bucket.attemptedCount,
        mistakeCounts: { ...bucket.mistakeCounts },
    };
}

/**
 * Score and rank derived buckets into ordered {@link ScoredWeakArea}s (design
 * step 6): descending by `weakAreaScore`, ties broken by `incorrectCount`
 * descending (Req 12.1, 12.3). Remaining ties (equal score and equal incorrect
 * count) fall back to the input order, which the derivation makes deterministic
 * (SUBJECT before TOPIC, then by key), so ranking is stable and deterministic.
 *
 * Pure: does not mutate the input array or its buckets (it sorts a fresh copy of
 * freshly projected objects).
 */
export function rankWeakAreas(buckets: ReadonlyArray<WeakAreaBucket>): ScoredWeakArea[] {
    return buckets
        .map((bucket, index) => ({ scored: toScoredWeakArea(bucket), index }))
        .sort((a, b) => {
            if (a.scored.weakAreaScore !== b.scored.weakAreaScore) {
                return b.scored.weakAreaScore - a.scored.weakAreaScore;
            }
            if (a.scored.incorrectCount !== b.scored.incorrectCount) {
                return b.scored.incorrectCount - a.scored.incorrectCount;
            }
            return a.index - b.index;
        })
        .map((entry) => entry.scored);
}

/**
 * Build the per-Topic `weakAreaScore` map (keyed by `topicKey`) from scored weak
 * areas, including only TOPIC-level entries — these are exactly the
 * Chapter/Topic buckets topic prioritization consumes (Req 12.2; design step 7).
 * SUBJECT-level areas are excluded since prioritization is per Topic.
 *
 * Pure: reads the scored areas without mutating them.
 */
export function buildWeakAreaScoreByTopic(
    weakAreas: ReadonlyArray<ScoredWeakArea>,
): Record<string, number> {
    const byTopic: Record<string, number> = {};
    for (const area of weakAreas) {
        if (area.level === 'TOPIC') {
            byTopic[area.key] = area.weakAreaScore;
        }
    }
    return byTopic;
}

/**
 * Top-level entry point: from already-read Phase 1 rows, produce the ranked
 * scored weak areas, the per-Session_Type study-time distribution, and the
 * per-Topic `weakAreaScore` map — everything the Weak-Area service (task 23.1)
 * and topic prioritization (task 20.1) need (design steps 5–8; Req 11.3, 12.1,
 * 12.2, 12.3). Pure and database-free; never mutates its input.
 */
export function computeWeakAreas(input: WeakAreaDerivationInput): ScoredWeakAreaResult {
    return scoreWeakAreaDerivation(deriveWeakAreas(input));
}

/**
 * Score and rank an already-computed {@link WeakAreaDerivation} (the output of
 * {@link deriveWeakAreas}), for callers that have separately derived the buckets
 * and session-type distribution. Pure; never mutates the derivation.
 */
export function scoreWeakAreaDerivation(derivation: WeakAreaDerivation): ScoredWeakAreaResult {
    const weakAreas = rankWeakAreas(derivation.buckets);
    return {
        weakAreas,
        sessionTypeDistribution: derivation.sessionTypeDistribution,
        weakAreaScoreByTopic: buildWeakAreaScoreByTopic(weakAreas),
    };
}
