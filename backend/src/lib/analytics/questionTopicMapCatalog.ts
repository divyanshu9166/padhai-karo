/**
 * Question -> Topic map catalog (Performance Analytics, task 1.4).
 *
 * Phase 1 stores `subjectId` on `PYQ` but never links a question to a chapter/topic.
 * To derive Chapter/Topic-level Weak_Areas and to join Topic_Frequency_Records to a
 * user's performance, this spec adds the additive `QuestionTopicMap` model
 * (`questionId -> topicKey`, where `topicKey` is a Phase 1 `Chapter.referenceKey`).
 * This leaves the Phase 1 `PYQ` model unchanged (Req 13.3) — the mapping references
 * `PYQ.id` by value with no FK back-reference added to `PYQ`.
 *
 * Why a catalog of *deterministic* question ids rather than a literal `PYQ.id` map:
 * the Phase 1 seed (`prisma/seed.ts`) seeds only Subjects — it does NOT seed any `PYQ`
 * rows, and `PYQ.id` defaults to a random uuid. There are therefore no stable question
 * ids to map against today. Following the Phase 1 convention of stable string ids for
 * seeded rows (e.g. `Subject.id === ReferenceSubject.key`), this catalog defines a
 * deterministic question id per (topic, index) via {@link makeSeededQuestionId}. The
 * analytics seed step (task 1.5) creates the representative `PYQ` rows using exactly
 * these ids and then upserts one `QuestionTopicMap` row per entry, so the question and
 * its topic mapping always agree and re-seeding is idempotent.
 *
 * The mapping is derived from the canonical reference catalog (`lib/reference`), so
 * every `topicKey` is guaranteed to be a real Phase 1 `Chapter.referenceKey` and every
 * `subjectId` a real seeded `Subject.id`, across BOTH tracks (JEE and NEET).
 *
 * Authored as plain TypeScript (no Prisma import) so it can be consumed by the seed,
 * by pure analytics modules, and by tests without a live database.
 */
import { EXAM_TRACKS, getChapters } from '../reference/catalog';
import type { ExamTrack } from '../reference/types';

/**
 * One question -> topic mapping row.
 *
 * Field names and types align exactly with the Prisma `QuestionTopicMap` model
 * (`questionId`, `examTrack`, `subjectId`, `topicKey`); `id`, `createdAt`, and
 * `updatedAt` are supplied by the database at upsert time and are intentionally absent
 * here. This is the shape the seed (task 1.5) upserts by its natural key (`questionId`).
 */
export interface QuestionTopicMapEntry {
    /** The seeded `PYQ.id` this mapping is for (see {@link makeSeededQuestionId}). */
    questionId: string;
    /** The Exam_Track the question belongs to (mirrors Prisma `ExamTrack`). */
    examTrack: ExamTrack;
    /** The owning `Subject.id` (== reference catalog `ReferenceSubject.key`). */
    subjectId: string;
    /** The Topic key == Phase 1 `Chapter.referenceKey`. */
    topicKey: string;
}

/**
 * A representative seeded question, enriched with the data the analytics seed (task 1.5)
 * needs to create the backing `PYQ` row in addition to the `QuestionTopicMap` row.
 *
 * `QuestionTopicMapEntry` is the strict, model-aligned subset; the extra fields
 * (`subjectName`, `topicName`, `year`) are seed conveniences and are NOT part of the
 * `QuestionTopicMap` model.
 */
export interface SeededQuestionTopicEntry extends QuestionTopicMapEntry {
    /** Display name of the owning subject (from the reference catalog). */
    subjectName: string;
    /** Display name of the chapter/topic (from the reference catalog). */
    topicName: string;
    /** Representative paper year for the seeded `PYQ` row. */
    year: number;
}

/**
 * How many representative seeded questions to associate with each topic. Two per topic
 * gives every chapter/topic across both tracks at least one correct- and one
 * incorrect-eligible question for weak-area derivation, while keeping the seed small.
 */
export const QUESTIONS_PER_TOPIC = 2;

/** Representative paper year stamped on the seeded questions. */
export const SEEDED_QUESTION_YEAR = 2024;

/** Stable prefix for every deterministic seeded analytics question id. */
export const SEEDED_QUESTION_ID_PREFIX = 'SEED-PYQ';

/**
 * Builds the deterministic, stable `PYQ.id` for the `index`-th (1-based) representative
 * question of a topic. The seed (task 1.5) MUST create the `PYQ` row with this exact id
 * so the `QuestionTopicMap.questionId` resolves to a real question. Stable across runs,
 * so re-seeding upserts rather than duplicates.
 *
 * Example: `makeSeededQuestionId('JEE-PHY-MECHANICS', 1)` -> `SEED-PYQ-JEE-PHY-MECHANICS-1`.
 */
export function makeSeededQuestionId(topicKey: string, index: number): string {
    return `${SEEDED_QUESTION_ID_PREFIX}-${topicKey}-${index}`;
}

/**
 * Deterministically derives the full set of representative seeded questions (with their
 * topic mapping) from the canonical reference catalog, for every Exam_Track. Each topic
 * (chapter) contributes {@link QUESTIONS_PER_TOPIC} questions with stable ids.
 *
 * Pure and deterministic: same catalog in => same rows out, in stable order.
 */
export function buildSeededQuestionTopicEntries(): SeededQuestionTopicEntry[] {
    const entries: SeededQuestionTopicEntry[] = [];

    for (const examTrack of EXAM_TRACKS) {
        for (const chapter of getChapters(examTrack)) {
            for (let index = 1; index <= QUESTIONS_PER_TOPIC; index += 1) {
                entries.push({
                    questionId: makeSeededQuestionId(chapter.referenceKey, index),
                    examTrack,
                    subjectId: chapter.subjectKey,
                    topicKey: chapter.referenceKey,
                    subjectName: chapter.subjectName,
                    topicName: chapter.name,
                    year: SEEDED_QUESTION_YEAR,
                });
            }
        }
    }

    return entries;
}

/**
 * The representative question->topic map catalog across both tracks, precomputed from
 * the reference catalog. This is the structure the analytics seed (task 1.5) consumes.
 */
export const SEEDED_QUESTION_TOPIC_ENTRIES: readonly SeededQuestionTopicEntry[] =
    buildSeededQuestionTopicEntries();

/**
 * The strict, `QuestionTopicMap`-model-aligned rows (the seed-convenience fields
 * stripped). This is what task 1.5 upserts into the `QuestionTopicMap` table, keyed by
 * the natural key `questionId`.
 */
export const QUESTION_TOPIC_MAP_CATALOG: readonly QuestionTopicMapEntry[] =
    SEEDED_QUESTION_TOPIC_ENTRIES.map(({ questionId, examTrack, subjectId, topicKey }) => ({
        questionId,
        examTrack,
        subjectId,
        topicKey,
    }));

/**
 * Returns the question->topic map rows for a single Exam_Track. Convenience reader for
 * the seed and for analytics modules that scope by track.
 */
export function getQuestionTopicMap(track: ExamTrack): QuestionTopicMapEntry[] {
    return QUESTION_TOPIC_MAP_CATALOG.filter((entry) => entry.examTrack === track);
}
