/**
 * Year-versioned Topic_Frequency_Reference_Data catalog (task 1.3).
 *
 * System-supplied historical paper-composition data: for every Topic (== a Phase 1
 * `Chapter.referenceKey`) this records how often the Topic appeared across the most
 * recent ~10 years of JEE Main / NEET papers and the average number of questions per
 * year (Req 6.1, 6.2). It is authored as plain TypeScript — exactly like the Phase 1
 * `lib/reference` catalog — so it can be imported without a database by the Prisma seed
 * (task 1.5) and the topic-trend reader (Epic 8/19).
 *
 * Keying: the dataset is keyed by `(examTrack, referenceDataYear)`. `referenceDataYear`
 * is the yearly *version label* (the year the dataset was compiled), not an exam year;
 * the exam years actually covered are recorded per record as `[yearSpanStart, yearSpanEnd]`.
 * Loading a later `referenceDataYear` is additive and retains prior versions (Req 6.4);
 * the active version is the maximum `referenceDataYear` for a track (Req 6.3), resolved
 * by `lib/analytics/referenceVersion.ts`.
 *
 * Each `Topic_Frequency_Record` field name and type aligns 1:1 with the Prisma
 * `TopicFrequencyReferenceData` model (see prisma/schema.prisma): `topicKey`,
 * `topicName`, `subjectKey`, `appearanceCount` (Int), `yearSpanStart` (Int),
 * `yearSpanEnd` (Int), `avgQuestionsPerYear` (Float).
 *
 * Data provenance: the per-Topic counts below are *representative illustrative* values
 * over a 10-exam-year span, derived deterministically from each chapter's catalog
 * weightage so every seeded chapter is covered and `topicKey` always matches an actual
 * Phase 1 `Chapter.referenceKey`. They are seed defaults a yearly refresh replaces with
 * audited NTA paper data; they are not an authoritative count.
 */
import { getChapters } from '../reference';
import type { ExamTrack } from '../reference';

/**
 * A single Topic_Frequency_Reference_Data entry for one Topic within a
 * `(examTrack, referenceDataYear)` dataset. Field names/types mirror the Prisma
 * `TopicFrequencyReferenceData` model (minus the DB-managed `id`/timestamps and the
 * dataset-level `examTrack`/`referenceDataYear` keys carried by the enclosing dataset).
 */
export interface TopicFrequencyRecord {
    /** == Phase 1 `Chapter.referenceKey` — the Topic key used to join user weak areas. */
    topicKey: string;
    /** Human-readable Topic (chapter) name. */
    topicName: string;
    /** Owning subject key (== Phase 1 reference `Subject.key`). */
    subjectKey: string;
    /** Appearances (questions) across the covered exam-year span. Int, >= 0 (Req 6.2). */
    appearanceCount: number;
    /** First covered exam year (inclusive). Int (Req 6.2). */
    yearSpanStart: number;
    /** Last covered exam year (inclusive). Int (Req 6.2). */
    yearSpanEnd: number;
    /** Average questions per year across the span. Float, >= 0 (Req 6.2). */
    avgQuestionsPerYear: number;
}

/** A complete Topic_Frequency_Reference_Data version for one track. */
export interface TopicFrequencyDataset {
    examTrack: ExamTrack;
    /** Yearly version label (Reference_Data_Year). Active = max per track (Req 6.3). */
    referenceDataYear: number;
    records: TopicFrequencyRecord[];
}

/**
 * A flattened, seed-ready row: a `TopicFrequencyRecord` plus its dataset keys. This is
 * the exact shape the Prisma seed (task 1.5) upserts into `TopicFrequencyReferenceData`,
 * matched on the natural key `(examTrack, referenceDataYear, topicKey)`.
 */
export interface TopicFrequencyRow extends TopicFrequencyRecord {
    examTrack: ExamTrack;
    referenceDataYear: number;
}

/** The covered exam-year span for the seeded datasets: a 10-year window. */
const YEAR_SPAN_START = 2015;
const YEAR_SPAN_END = 2024;
const SPAN_YEARS = YEAR_SPAN_END - YEAR_SPAN_START + 1; // 10

/**
 * Approximate number of scored questions in one paper, per track, used only to turn a
 * chapter's catalog weightage (~ % of the paper) into a representative illustrative
 * question count over the span. JEE Main = 75 scored questions; NEET = 180.
 */
const QUESTIONS_PER_PAPER: Record<ExamTrack, number> = {
    JEE: 75,
    NEET: 180,
};

/**
 * Derive one Topic_Frequency_Record from a catalog chapter. The illustrative
 * `appearanceCount` is `round(weightage% * questionsPerPaper * spanYears)`, clamped to
 * a minimum of 1 so every seeded chapter has a non-zero historical footprint;
 * `avgQuestionsPerYear` is `appearanceCount / spanYears` rounded to one decimal.
 */
function deriveRecord(
    track: ExamTrack,
    chapter: { referenceKey: string; name: string; subjectKey: string; weightage: number },
): TopicFrequencyRecord {
    const perPaper = (chapter.weightage / 100) * QUESTIONS_PER_PAPER[track];
    const appearanceCount = Math.max(1, Math.round(perPaper * SPAN_YEARS));
    const avgQuestionsPerYear = Math.round((appearanceCount / SPAN_YEARS) * 10) / 10;
    return {
        topicKey: chapter.referenceKey,
        topicName: chapter.name,
        subjectKey: chapter.subjectKey,
        appearanceCount,
        yearSpanStart: YEAR_SPAN_START,
        yearSpanEnd: YEAR_SPAN_END,
        avgQuestionsPerYear,
    };
}

/** Build the full record set for a track from the Phase 1 reference chapter catalog. */
function buildRecords(track: ExamTrack): TopicFrequencyRecord[] {
    return getChapters(track).map((chapter) =>
        deriveRecord(track, {
            referenceKey: chapter.referenceKey,
            name: chapter.name,
            subjectKey: chapter.subjectKey,
            weightage: chapter.weightage,
        }),
    );
}

/**
 * The active Reference_Data_Year shipped for each track's seeded topic-frequency data.
 * A later version is added as an additional `TopicFrequencyDataset` entry below; prior
 * entries are retained so historical versions remain queryable (Req 6.4).
 */
export const TOPIC_FREQUENCY_REFERENCE_DATA_YEAR: Record<ExamTrack, number> = {
    JEE: 2025,
    NEET: 2025,
};

/**
 * Year-versioned Topic_Frequency_Reference_Data, one dataset per
 * `(examTrack, referenceDataYear)`. Provides a representative dataset covering every
 * seeded chapter for both tracks (JEE and NEET) for one Reference_Data_Year each.
 */
export const TOPIC_FREQUENCY_CATALOG: TopicFrequencyDataset[] = [
    {
        examTrack: 'JEE',
        referenceDataYear: TOPIC_FREQUENCY_REFERENCE_DATA_YEAR.JEE,
        records: buildRecords('JEE'),
    },
    {
        examTrack: 'NEET',
        referenceDataYear: TOPIC_FREQUENCY_REFERENCE_DATA_YEAR.NEET,
        records: buildRecords('NEET'),
    },
];

// === Accessors ==============================================================

/** Returns the topic-frequency dataset for a `(track, year)`, or `undefined`. */
export function getTopicFrequencyDataset(
    track: ExamTrack,
    referenceDataYear: number,
): TopicFrequencyDataset | undefined {
    return TOPIC_FREQUENCY_CATALOG.find(
        (dataset) => dataset.examTrack === track && dataset.referenceDataYear === referenceDataYear,
    );
}

/** The Reference_Data_Years present for a track, ascending (most recent last). */
export function getTopicFrequencyYears(track: ExamTrack): number[] {
    return TOPIC_FREQUENCY_CATALOG.filter((dataset) => dataset.examTrack === track)
        .map((dataset) => dataset.referenceDataYear)
        .sort((a, b) => a - b);
}

/**
 * Flattens the catalog into seed-ready rows (one per Topic per dataset version), each
 * carrying its `(examTrack, referenceDataYear, topicKey)` natural key. Consumed by the
 * idempotent Prisma seed in task 1.5.
 */
export function getAllTopicFrequencyRows(): TopicFrequencyRow[] {
    return TOPIC_FREQUENCY_CATALOG.flatMap((dataset) =>
        dataset.records.map((record) => ({
            ...record,
            examTrack: dataset.examTrack,
            referenceDataYear: dataset.referenceDataYear,
        })),
    );
}
