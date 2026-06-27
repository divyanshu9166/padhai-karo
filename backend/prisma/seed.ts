/**
 * Prisma seed script (task 3.1 + Performance Analytics task 1.5).
 *
 * Idempotently upserts the catalog's Subjects into the database. Subjects are keyed by
 * a stable string id (the catalog `ReferenceSubject.key`, e.g. "JEE-PHYSICS") so that
 * re-running the seed never creates duplicates — an upsert by primary key is a no-op
 * when the row already exists with the same data.
 *
 * Chapters are intentionally NOT seeded here: in the data model a `Chapter` is a
 * per-user instance created at onboarding (task 4.1) from the canonical catalog
 * (see src/lib/reference). The seed therefore only needs to establish the shared,
 * track-keyed Subject rows that those per-user chapters reference.
 *
 * Phase 2 — Performance Analytics reference data (task 1.5): in addition to Subjects,
 * this seed upserts the system-supplied, year-versioned analytics reference datasets
 * authored as TypeScript catalogs (`src/lib/analytics/*`):
 *
 *  - `CutoffReferenceData`         — by natural key (examTrack, referenceDataYear,
 *                                    collegeName, branchName, category).
 *  - `ScoreStandingMap`            — by natural key (examTrack, referenceDataYear,
 *                                    minScorePercent, maxScorePercent).
 *  - `TopicFrequencyReferenceData` — by natural key (examTrack, referenceDataYear,
 *                                    topicKey).
 *  - representative `PYQ` rows     — by their deterministic seeded id so
 *                                    `QuestionTopicMap.questionId` resolves to a real
 *                                    question (the Phase 1 seed does not seed PYQ rows).
 *  - `QuestionTopicMap`            — by natural key (questionId).
 *
 * Every upsert is keyed by a natural/primary key, so re-seeding is idempotent (no
 * duplicates) and loading a later `referenceDataYear` is additive — prior years' rows
 * are retained (Req 5.1, 5.3, 6.1, 6.4).
 *
 * Run with: `npx prisma db seed` (wired via the `prisma.seed` field in package.json).
 * Requires a reachable PostgreSQL instance (DATABASE_URL). The script is safe to run
 * repeatedly.
 */
import { PrismaClient } from '@prisma/client';

import {
    CUTOFF_EXAM_TRACKS,
    getCutoffEntries,
    getCutoffYears,
    getScoreStandingBands,
    getScoreStandingYears,
} from '../src/lib/analytics/cutoffCatalog';
import { getAllTopicFrequencyRows } from '../src/lib/analytics/topicFrequencyCatalog';
import { SEEDED_QUESTION_TOPIC_ENTRIES } from '../src/lib/analytics/questionTopicMapCatalog';
import { getAllSubjects } from '../src/lib/reference/catalog';

const prisma = new PrismaClient();

async function seedSubjects(): Promise<number> {
    const subjects = getAllSubjects();

    for (const subject of subjects) {
        // Upsert by stable primary key so the seed is idempotent.
        await prisma.subject.upsert({
            where: { id: subject.key },
            update: { name: subject.name, examTrack: subject.examTrack },
            create: { id: subject.key, name: subject.name, examTrack: subject.examTrack },
        });
    }

    return subjects.length;
}

/**
 * Upsert Cutoff_Reference_Data rows by the natural key
 * (examTrack, referenceDataYear, collegeName, branchName, category). Iterates every
 * track + year present in the catalog so additional years are additive (Req 5.1, 5.3).
 */
async function seedCutoffReferenceData(): Promise<number> {
    let count = 0;

    for (const examTrack of CUTOFF_EXAM_TRACKS) {
        for (const referenceDataYear of getCutoffYears(examTrack)) {
            for (const entry of getCutoffEntries(examTrack, referenceDataYear)) {
                await prisma.cutoffReferenceData.upsert({
                    where: {
                        examTrack_referenceDataYear_collegeName_branchName_category: {
                            examTrack,
                            referenceDataYear,
                            collegeName: entry.collegeName,
                            branchName: entry.branchName,
                            category: entry.category,
                        },
                    },
                    update: {
                        closingValue: entry.closingValue,
                        unit: entry.unit,
                    },
                    create: {
                        examTrack,
                        referenceDataYear,
                        collegeName: entry.collegeName,
                        branchName: entry.branchName,
                        category: entry.category,
                        closingValue: entry.closingValue,
                        unit: entry.unit,
                    },
                });
                count += 1;
            }
        }
    }

    return count;
}

/**
 * Upsert Score_Standing_Map bands by the natural key
 * (examTrack, referenceDataYear, minScorePercent, maxScorePercent). Versioned alongside
 * the cutoff data; additional years are additive (Req 3.1, 3.2, 5.3).
 */
async function seedScoreStandingMap(): Promise<number> {
    let count = 0;

    for (const examTrack of CUTOFF_EXAM_TRACKS) {
        for (const referenceDataYear of getScoreStandingYears(examTrack)) {
            for (const band of getScoreStandingBands(examTrack, referenceDataYear)) {
                await prisma.scoreStandingMap.upsert({
                    where: {
                        examTrack_referenceDataYear_minScorePercent_maxScorePercent: {
                            examTrack,
                            referenceDataYear,
                            minScorePercent: band.minScorePercent,
                            maxScorePercent: band.maxScorePercent,
                        },
                    },
                    update: {
                        estimateLow: band.estimateLow,
                        estimateHigh: band.estimateHigh,
                        unit: band.unit,
                    },
                    create: {
                        examTrack,
                        referenceDataYear,
                        minScorePercent: band.minScorePercent,
                        maxScorePercent: band.maxScorePercent,
                        estimateLow: band.estimateLow,
                        estimateHigh: band.estimateHigh,
                        unit: band.unit,
                    },
                });
                count += 1;
            }
        }
    }

    return count;
}

/**
 * Upsert Topic_Frequency_Reference_Data rows by the natural key
 * (examTrack, referenceDataYear, topicKey). One row per Topic per dataset version;
 * additional years are additive (Req 6.1, 6.2, 6.4).
 */
async function seedTopicFrequencyReferenceData(): Promise<number> {
    const rows = getAllTopicFrequencyRows();

    for (const row of rows) {
        await prisma.topicFrequencyReferenceData.upsert({
            where: {
                examTrack_referenceDataYear_topicKey: {
                    examTrack: row.examTrack,
                    referenceDataYear: row.referenceDataYear,
                    topicKey: row.topicKey,
                },
            },
            update: {
                topicName: row.topicName,
                subjectKey: row.subjectKey,
                appearanceCount: row.appearanceCount,
                yearSpanStart: row.yearSpanStart,
                yearSpanEnd: row.yearSpanEnd,
                avgQuestionsPerYear: row.avgQuestionsPerYear,
            },
            create: {
                examTrack: row.examTrack,
                referenceDataYear: row.referenceDataYear,
                topicKey: row.topicKey,
                topicName: row.topicName,
                subjectKey: row.subjectKey,
                appearanceCount: row.appearanceCount,
                yearSpanStart: row.yearSpanStart,
                yearSpanEnd: row.yearSpanEnd,
                avgQuestionsPerYear: row.avgQuestionsPerYear,
            },
        });
    }

    return rows.length;
}

/**
 * Create the representative seeded `PYQ` rows (by their deterministic id) and upsert the
 * `QuestionTopicMap` rows (by `questionId`) so each mapping resolves to a real question.
 *
 * The Phase 1 seed does NOT seed PYQ rows and `PYQ.id` defaults to a random uuid; the
 * question->topic catalog therefore defines deterministic ids via `makeSeededQuestionId`.
 * Here we materialize the backing PYQ row with that exact id (upsert by primary key) and
 * then the mapping row (upsert by the unique `questionId`), both idempotent (Req 11.1,
 * 13.3). PYQ required fields are populated from the enriched catalog entries: exactly
 * four options and a valid `correctOption` index per the Phase 1 PYQ model.
 */
async function seedQuestionTopicMap(): Promise<number> {
    for (const entry of SEEDED_QUESTION_TOPIC_ENTRIES) {
        // Representative options: exactly four (Req 7.1/7.3); first option is correct.
        const options = ['Option A', 'Option B', 'Option C', 'Option D'];
        const correctOption = 0;
        const questionText = `Representative ${entry.subjectName} question on ${entry.topicName}`;

        // Materialize the backing PYQ row with the deterministic seeded id.
        await prisma.pYQ.upsert({
            where: { id: entry.questionId },
            update: {
                examTrack: entry.examTrack,
                year: entry.year,
                subjectId: entry.subjectId,
                questionText,
                options,
                correctOption,
            },
            create: {
                id: entry.questionId,
                examTrack: entry.examTrack,
                year: entry.year,
                subjectId: entry.subjectId,
                questionText,
                options,
                correctOption,
            },
        });

        // Upsert the question->topic mapping by its natural key (questionId).
        await prisma.questionTopicMap.upsert({
            where: { questionId: entry.questionId },
            update: {
                examTrack: entry.examTrack,
                subjectId: entry.subjectId,
                topicKey: entry.topicKey,
            },
            create: {
                questionId: entry.questionId,
                examTrack: entry.examTrack,
                subjectId: entry.subjectId,
                topicKey: entry.topicKey,
            },
        });
    }

    return SEEDED_QUESTION_TOPIC_ENTRIES.length;
}

async function main(): Promise<void> {
    const subjectCount = await seedSubjects();
    const cutoffCount = await seedCutoffReferenceData();
    const scoreStandingCount = await seedScoreStandingMap();
    const topicFrequencyCount = await seedTopicFrequencyReferenceData();
    const questionTopicCount = await seedQuestionTopicMap();

    // eslint-disable-next-line no-console
    console.log(
        `Seed complete: upserted ${subjectCount} subjects, ${cutoffCount} cutoff rows, ` +
        `${scoreStandingCount} score-standing bands, ${topicFrequencyCount} topic-frequency rows, ` +
        `${questionTopicCount} seeded questions + question-topic maps.`,
    );
}

main()
    .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Seed failed:', error);
        process.exitCode = 1;
    })
    .finally(() => {
        void prisma.$disconnect();
    });
