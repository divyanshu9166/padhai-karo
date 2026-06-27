/**
 * Pure Topic-Trend projection & ordering (task 8.1; design "Topic Trend endpoint" and the
 * "Topic trend ordering & zero-fill" algorithm; Req 7.1, 7.2, 7.3).
 *
 * The Topic Trend endpoint surfaces, for every Topic in the user's Exam_Track, how often
 * that Topic appeared in past papers and its average questions per year, drawn from the
 * active Topic_Frequency_Reference_Data (Req 7.1). Crucially the *universe* of topics is the
 * track's chapter catalog (`lib/reference`), NOT the frequency dataset: a Topic that the
 * frequency dataset does not mention must still appear, zero-filled and flagged as having no
 * historical frequency data (Req 7.3). The series is ordered by average questions per year,
 * descending (Req 7.2).
 *
 * Following the Phase 1 layering convention (see `trajectory.ts`, `dashboardAggregation.ts`,
 * `lib/scoring/score.ts`), this module:
 *   - imports no Prisma client and no framework code,
 *   - accepts already-read plain rows (the thin service handler reads the track topic
 *     universe from `lib/reference` and the active topic-frequency rows from the database,
 *     scoped to the user's track, and passes them in),
 *   - never mutates its inputs (returns a new array),
 *   - is the property-test surface for topic-trend behavior (task 8.2, Property 9).
 *
 * ── Left-join & projection (Req 7.1, 7.3) ─────────────────────────────────────────────────
 * The topic universe is left-joined against the active frequency records by `topicKey`:
 *   - a Topic WITH a matching record projects that record's `appearanceCount`, year span,
 *     and `avgQuestionsPerYear`, and is flagged `hasFrequencyData = true`;
 *   - a Topic WITHOUT a matching record is zero-filled: `appearanceCount = 0`,
 *     `avgQuestionsPerYear = 0`, `yearSpan = null`, and `hasFrequencyData = false`.
 * `topicName`/`subjectName` always come from the universe (the catalog is the source of
 * truth for the Topic's identity), so the projection is total over the universe regardless
 * of frequency coverage.
 *
 * ── Ordering (Req 7.2) ────────────────────────────────────────────────────────────────────
 * The result is sorted by `avgQuestionsPerYear` descending. Ties (including all zero-filled
 * topics, which share `avgQuestionsPerYear = 0`) break by `topicName` ascending, giving a
 * deterministic, stable ordering independent of input order.
 */

/**
 * One Topic in the track's universe, as read from the reference chapter catalog
 * (`lib/reference` `getChapters`, where Topic == Chapter `referenceKey`). Deliberately
 * minimal: only the identity fields the projection needs. Plain DB-free shape — the service
 * maps catalog chapters onto this.
 */
export interface TopicUniverseEntry {
    /** == Phase 1 `Chapter.referenceKey` — the Topic key used to join frequency records. */
    topicKey: string;
    /** Human-readable Topic (chapter) name; the source of truth for the Topic's name. */
    topicName: string;
    /** Owning subject display name (e.g. "Physics"). */
    subjectName: string;
}

/**
 * One active Topic_Frequency_Reference_Data record as needed for projection. Structurally a
 * subset of `TopicFrequencyRecord` (see `lib/analytics/topicFrequencyCatalog.ts`) — the
 * service passes already-read rows for the active `(examTrack, referenceDataYear)` version.
 * Accepting a minimal structural shape keeps this pure module decoupled from the catalog.
 */
export interface ActiveTopicFrequencyRecord {
    /** == Phase 1 `Chapter.referenceKey` — joins to a {@link TopicUniverseEntry}. */
    topicKey: string;
    /** Appearances across the covered exam-year span (Req 7.1). */
    appearanceCount: number;
    /** First covered exam year (inclusive). */
    yearSpanStart: number;
    /** Last covered exam year (inclusive). */
    yearSpanEnd: number;
    /** Average questions per year across the span (Req 7.1). */
    avgQuestionsPerYear: number;
}

/** The covered exam-year span of a Topic's frequency record; `null` when zero-filled. */
export interface YearSpan {
    start: number;
    end: number;
}

/**
 * A single projected Topic-trend row (design "Topic Trend endpoint"). `hasFrequencyData`
 * distinguishes a Topic backed by a frequency record (`true`) from a zero-filled Topic that
 * the active dataset does not mention (`false`, Req 7.3).
 */
export interface TopicTrend {
    topicKey: string;
    topicName: string;
    subjectName: string;
    /** `appearanceCount` from the record, or `0` when zero-filled (Req 7.3). */
    appearanceCount: number;
    /** The record's covered year span, or `null` when zero-filled (Req 7.3). */
    yearSpan: YearSpan | null;
    /** `avgQuestionsPerYear` from the record, or `0` when zero-filled (Req 7.3). */
    avgQuestionsPerYear: number;
    /** `true` when a frequency record exists for the Topic; `false` otherwise (Req 7.3). */
    hasFrequencyData: boolean;
}

/**
 * Project one universe Topic against its (possibly absent) frequency record. With a record,
 * the record's counts/span/average are projected and `hasFrequencyData = true`; without one,
 * the Topic is zero-filled with a `null` span and `hasFrequencyData = false` (Req 7.1, 7.3).
 */
function projectTopic(
    topic: TopicUniverseEntry,
    record: ActiveTopicFrequencyRecord | undefined,
): TopicTrend {
    if (record === undefined) {
        return {
            topicKey: topic.topicKey,
            topicName: topic.topicName,
            subjectName: topic.subjectName,
            appearanceCount: 0,
            yearSpan: null,
            avgQuestionsPerYear: 0,
            hasFrequencyData: false,
        };
    }
    return {
        topicKey: topic.topicKey,
        topicName: topic.topicName,
        subjectName: topic.subjectName,
        appearanceCount: record.appearanceCount,
        yearSpan: { start: record.yearSpanStart, end: record.yearSpanEnd },
        avgQuestionsPerYear: record.avgQuestionsPerYear,
        hasFrequencyData: true,
    };
}

/**
 * Project the track's Topic universe against the active Topic_Frequency_Reference_Data,
 * producing one {@link TopicTrend} per universe Topic, ordered by `avgQuestionsPerYear`
 * descending with a stable `topicName`-ascending tiebreak (Req 7.1, 7.2, 7.3).
 *
 * The universe (the track's chapter catalog) drives the output: every Topic appears exactly
 * once, whether or not the active frequency dataset mentions it (Req 7.3). Frequency records
 * are matched by `topicKey`; a record whose `topicKey` is absent from the universe is
 * ignored (the universe is the authoritative set of the user's track topics).
 *
 * Pure: no I/O, builds and returns a new array, does not mutate any input row or array.
 *
 * @param topicUniverse The track's Topic universe (catalog chapters as topics).
 * @param activeRecords The active `(examTrack, referenceDataYear)` topic-frequency records.
 */
export function projectTopicTrends(
    topicUniverse: readonly TopicUniverseEntry[],
    activeRecords: readonly ActiveTopicFrequencyRecord[],
): TopicTrend[] {
    const recordsByTopicKey = new Map<string, ActiveTopicFrequencyRecord>();
    for (const record of activeRecords) {
        recordsByTopicKey.set(record.topicKey, record);
    }

    const trends = topicUniverse.map((topic) =>
        projectTopic(topic, recordsByTopicKey.get(topic.topicKey)),
    );

    trends.sort((a, b) => {
        if (b.avgQuestionsPerYear !== a.avgQuestionsPerYear) {
            return b.avgQuestionsPerYear - a.avgQuestionsPerYear;
        }
        return a.topicName.localeCompare(b.topicName);
    });

    return trends;
}
