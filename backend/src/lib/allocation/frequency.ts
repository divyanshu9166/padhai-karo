/**
 * Pure PYQ and historical per-Chapter frequency derivation (task 3.1; design
 * "frequency.ts — PYQ and historical frequency"; Req 1.1–1.5, 2.1, 2.3, 2.4).
 *
 * This is the first pure module of the Weightage-Based Time Allocation feature.
 * Following the established Phase 1 / Performance Analytics layering convention
 * (see `src/services/analytics/topicPriority.ts`, `src/lib/timetable/*`), this
 * module:
 *   - imports no Prisma client and no framework code (database- and
 *     framework-free),
 *   - accepts already-read plain rows that the thin service reader
 *     (`allocationReader.ts`, task 9.1) supplies,
 *   - never mutates its inputs (it only reads them and builds fresh output
 *     collections),
 *   - reads defensively so that malformed or empty inputs never throw — every
 *     output is well-defined for any input,
 *   - is part of the property-test surface (tasks 3.2, 3.3 — Properties 1 & 2).
 *
 * ── PYQ_Chapter_Frequency (Req 1) ─────────────────────────────────────────────
 * For each Chapter, `pyqChapterFrequency` counts the User's per-question
 * outcomes whose `questionId` resolves — through a `QuestionTopicLink` whose
 * `topicKey` equals the Chapter's `referenceKey` — to that Chapter (Req 1.1).
 *   - A question with no link contributes to no Chapter (Req 1.2).
 *   - A question whose `topicKey` matches more than one Chapter `referenceKey`
 *     increments each matched Chapter by exactly one for that outcome (Req 1.3).
 *   - Each outcome is counted at most once per Chapter, even if duplicate links
 *     resolve the same outcome to the same Chapter (Req 1.4).
 *   - No attempts / empty inputs yield zero for every Chapter (Req 1.5); a
 *     Chapter the caller supplies always appears in the result map.
 *
 * ── Historical_Chapter_Frequency (Req 2) ──────────────────────────────────────
 * `historicalChapterFrequency` maps each Chapter to the `avgQuestionsPerYear` of
 * the active-year `Topic_Frequency_Record` whose `topicKey` equals the Chapter's
 * `referenceKey`; when no such record exists the Chapter gets `value 0` and
 * `hasHistoricalData = false` (Req 2.3). Dataset-version selection (Req 2.2) is
 * the caller's responsibility (via `resolveActiveReferenceYear`); this pure
 * function receives only the already-selected active-year records, so an empty
 * `records` list — e.g. no dataset exists for the track — yields zero with
 * `hasHistoricalData = false` for every Chapter (Req 2.4).
 */

/** Chapter progress state, mirroring the Phase 1 `Chapter_Status` enum. */
export type ChapterStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'REVISED';

/**
 * A User per-question outcome resolved from a `PYQAttempt`'s `perQuestion` JSON.
 * Only the `questionId` participates in the count: Req 1.1 counts the *presence*
 * of an attempted question, not the correctness of its outcome.
 */
export interface AttemptQuestionOutcome {
    questionId: string;
}

/**
 * A `QuestionTopicMap` entry linking a PYQ question to a Topic_Key. The
 * `topicKey` equals a Phase 1 `Chapter.referenceKey` (Performance Analytics
 * definition, reused).
 */
export interface QuestionTopicLink {
    questionId: string;
    topicKey: string;
}

/** Minimal Chapter shape the allocation math consumes. */
export interface AllocationChapter {
    id: string;
    referenceKey: string;
    status: ChapterStatus;
    /** Effective Phase 1 weightage AFTER applying any Weightage_Override (Req 8.2). */
    weightage: number | null;
    /** Phase 1 `weightageIsDefault` flag, carried through for fallback labeling (Req 6.3). */
    weightageIsDefault: boolean;
}

/** One active-year `Topic_Frequency_Record`. */
export interface TopicFrequencyRecord {
    topicKey: string;
    avgQuestionsPerYear: number;
}

/** Per-Chapter historical frequency result. */
export interface HistoricalFrequency {
    /** `avgQuestionsPerYear` of the matching record, or `0` (Req 2.1, 2.3, 2.4). */
    value: number;
    /** `false` => "no historical frequency data" label (Req 2.3, 2.4). */
    hasHistoricalData: boolean;
}

/**
 * Defensively coerce a possibly-malformed array input into a safe array of
 * entries. Returns an empty array for any non-array input (null, undefined, or a
 * non-array value) so callers never throw on malformed data.
 */
function safeArray<T>(value: readonly T[] | null | undefined): readonly T[] {
    return Array.isArray(value) ? value : [];
}

/**
 * Read a string-ish field defensively, returning `undefined` when the value is
 * absent or not a string. Used so a malformed row (missing/typed-wrong key) is
 * simply skipped rather than throwing.
 */
function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

/**
 * Compute each Chapter's `PYQ_Chapter_Frequency` from the User's per-question
 * outcomes, the `QuestionTopicMap` links, and the Chapter set (Req 1.1–1.5).
 *
 * Resolution: an outcome's `questionId` is mapped (via the links) to a set of
 * `topicKey`s; each `topicKey` selects every Chapter whose `referenceKey` equals
 * it. For a single outcome the matched Chapters are de-duplicated into a set, so
 * each Chapter is incremented at most once per outcome (Req 1.4) while a question
 * matching several Chapters increments each by one (Req 1.3). Outcomes whose
 * question has no link match no Chapter (Req 1.2).
 *
 * The returned map always contains an entry for every supplied Chapter; Chapters
 * with no resolved outcomes (including the no-attempts case) map to `0`
 * (Req 1.5). Pure: reads inputs only, mutates nothing, returns a fresh `Map`.
 *
 * @param outcomes The requesting User's per-question outcomes.
 * @param links `QuestionTopicMap` entries (`questionId` -> `topicKey`).
 * @param chapters The User's Chapters (the count universe).
 * @returns Map of `chapterId` -> non-negative integer frequency.
 */
export function pyqChapterFrequency(
    outcomes: readonly AttemptQuestionOutcome[],
    links: readonly QuestionTopicLink[],
    chapters: readonly AllocationChapter[],
): Map<string, number> {
    const safeChapters = safeArray(chapters);
    const safeLinks = safeArray(links);
    const safeOutcomes = safeArray(outcomes);

    // referenceKey -> set of chapterIds that carry it (a referenceKey may be
    // shared by multiple Chapters; Req 1.3 multi-match).
    const chaptersByReferenceKey = new Map<string, Set<string>>();
    // Seed the result with 0 for every supplied Chapter (Req 1.5).
    const frequency = new Map<string, number>();
    for (const chapter of safeChapters) {
        const chapterId = readString(chapter?.id);
        const referenceKey = readString(chapter?.referenceKey);
        if (chapterId === undefined) {
            continue;
        }
        frequency.set(chapterId, 0);
        if (referenceKey === undefined) {
            continue;
        }
        let bucket = chaptersByReferenceKey.get(referenceKey);
        if (bucket === undefined) {
            bucket = new Set<string>();
            chaptersByReferenceKey.set(referenceKey, bucket);
        }
        bucket.add(chapterId);
    }

    // questionId -> set of topicKeys linking it.
    const topicKeysByQuestion = new Map<string, Set<string>>();
    for (const link of safeLinks) {
        const questionId = readString(link?.questionId);
        const topicKey = readString(link?.topicKey);
        if (questionId === undefined || topicKey === undefined) {
            continue;
        }
        let keys = topicKeysByQuestion.get(questionId);
        if (keys === undefined) {
            keys = new Set<string>();
            topicKeysByQuestion.set(questionId, keys);
        }
        keys.add(topicKey);
    }

    for (const outcome of safeOutcomes) {
        const questionId = readString(outcome?.questionId);
        if (questionId === undefined) {
            continue;
        }
        const topicKeys = topicKeysByQuestion.get(questionId);
        if (topicKeys === undefined) {
            // No QuestionTopicMap entry => contributes to no Chapter (Req 1.2).
            continue;
        }
        // Collect the distinct Chapters this outcome resolves to, so each is
        // incremented at most once for this outcome (Req 1.3, 1.4).
        const matchedChapterIds = new Set<string>();
        for (const topicKey of topicKeys) {
            const bucket = chaptersByReferenceKey.get(topicKey);
            if (bucket === undefined) {
                continue;
            }
            for (const chapterId of bucket) {
                matchedChapterIds.add(chapterId);
            }
        }
        for (const chapterId of matchedChapterIds) {
            frequency.set(chapterId, (frequency.get(chapterId) ?? 0) + 1);
        }
    }

    return frequency;
}

/**
 * Map each Chapter to its `Historical_Chapter_Frequency` from the active-year
 * `Topic_Frequency_Record`s (Req 2.1, 2.3, 2.4).
 *
 * A Chapter whose `referenceKey` matches a record's `topicKey` takes that
 * record's `avgQuestionsPerYear` with `hasHistoricalData = true`; otherwise it
 * gets `value 0` with `hasHistoricalData = false` (Req 2.3). When `records` is
 * empty — e.g. no dataset exists for the track (Req 2.4) — every Chapter gets the
 * data-less zero. Records with a non-finite `avgQuestionsPerYear` are treated as
 * `0` defensively. The active dataset version (Req 2.2) is selected by the
 * caller; this function only consumes the already-selected records.
 *
 * The returned map always contains an entry for every supplied Chapter. Pure:
 * reads inputs only, mutates nothing, returns a fresh `Map`.
 *
 * @param chapters The User's Chapters.
 * @param records The active-year `Topic_Frequency_Record`s for the track.
 * @returns Map of `chapterId` -> {@link HistoricalFrequency}.
 */
export function historicalChapterFrequency(
    chapters: readonly AllocationChapter[],
    records: readonly TopicFrequencyRecord[],
): Map<string, HistoricalFrequency> {
    const safeChapters = safeArray(chapters);
    const safeRecords = safeArray(records);

    // topicKey -> avgQuestionsPerYear of the first record carrying it.
    const avgByTopicKey = new Map<string, number>();
    for (const record of safeRecords) {
        const topicKey = readString(record?.topicKey);
        if (topicKey === undefined || avgByTopicKey.has(topicKey)) {
            continue;
        }
        const avg = record?.avgQuestionsPerYear;
        avgByTopicKey.set(
            topicKey,
            typeof avg === 'number' && Number.isFinite(avg) ? avg : 0,
        );
    }

    const result = new Map<string, HistoricalFrequency>();
    for (const chapter of safeChapters) {
        const chapterId = readString(chapter?.id);
        if (chapterId === undefined) {
            continue;
        }
        const referenceKey = readString(chapter?.referenceKey);
        if (referenceKey !== undefined && avgByTopicKey.has(referenceKey)) {
            result.set(chapterId, {
                value: avgByTopicKey.get(referenceKey) as number,
                hasHistoricalData: true,
            });
        } else {
            result.set(chapterId, { value: 0, hasHistoricalData: false });
        }
    }

    return result;
}
