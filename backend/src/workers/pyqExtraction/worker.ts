/**
 * The `pyq-extraction` BullMQ worker (consumer) and its idempotent job processor
 * (task 12.1, design "PYQ Extraction Pipeline (Worker, Req 7)" and "Background-Job Model").
 *
 * Responsibilities (Req 7.1–7.4):
 *  - Run each operator-supplied source page image through the vision model into structured
 *    PYQ records (text + options + correct-answer ref).
 *  - Reconcile the stored correct answer to the official Answer_Key, never trusting the
 *    model's answer (Req 7.2).
 *  - Flag records without exactly four options (or without a reconciled key) for manual
 *    review and exclude them from practice (Req 7.3).
 *  - Associate each record with its Exam_Track / year / Subject (Req 7.4).
 *  - Be idempotent on re-running the same source image ref: records are upserted by a
 *    deterministic key so re-processing does not duplicate.
 *
 * The pure transformation lives in `extraction.ts`. This module is the thin I/O shell: it
 * loads the Answer_Key, invokes the {@link VisionExtractor}, and upserts records. All
 * external collaborators (the extractor and the database) are injected so the processor is
 * unit-testable with mocks and runs no live API call or real database during tests.
 */
import { Worker, type Job } from 'bullmq';

import { getRedisConnection, QUEUE_NAMES } from '@/lib/queue';

import { parseOfficialAnswerKey, processExtractionResult } from './extraction';
import type {
    ExtractionAssociation,
    ExtractionFailure,
    OfficialAnswerKey,
    PyqExtractionJobData,
    PyqExtractionJobResult,
    PyqUpsertRecord,
    VisionExtractor,
} from './types';

/**
 * The minimal database surface the processor needs, structurally compatible with the
 * Prisma client. Declared as an interface so tests can supply an in-memory fake without a
 * live PostgreSQL instance.
 */
export interface PyqExtractionDb {
    answerKey: {
        findUnique(args: {
            where: { id: string };
            select: { entries: true };
        }): Promise<{ entries: unknown } | null>;
    };
    pYQ: {
        upsert(args: {
            where: { id: string };
            create: PyqCreateInput;
            update: PyqUpdateInput;
        }): Promise<unknown>;
    };
}

/** Columns written when first creating a PYQ record. */
export interface PyqCreateInput {
    id: string;
    paperId: string | null;
    examTrack: PyqUpsertRecord['examTrack'];
    year: number;
    subjectId: string;
    questionText: string;
    options: string[];
    correctOption: number;
    flaggedForReview: boolean;
}

/** Columns refreshed when re-processing an existing record (idempotent re-run). */
export type PyqUpdateInput = Omit<PyqCreateInput, 'id'>;

/** Collaborators injected into the job processor. */
export interface PyqExtractionDeps {
    extractor: VisionExtractor;
    db: PyqExtractionDb;
}

/** Map a built record to the Prisma `create` payload. */
function toCreateInput(record: PyqUpsertRecord): PyqCreateInput {
    return {
        id: record.id,
        paperId: record.paperId,
        examTrack: record.examTrack,
        year: record.year,
        subjectId: record.subjectId,
        questionText: record.questionText,
        options: record.options,
        correctOption: record.correctOption,
        flaggedForReview: record.flaggedForReview,
    };
}

/** Map a built record to the Prisma `update` payload (everything but the id). */
function toUpdateInput(record: PyqUpsertRecord): PyqUpdateInput {
    const { id: _id, ...rest } = toCreateInput(record);
    void _id;
    return rest;
}

/**
 * Process one `pyq-extraction` job. Pure orchestration over injected collaborators:
 *
 *  1. Load and normalize the official Answer_Key once for the job (Req 7.2).
 *  2. For each source image ref, extract questions via the (mockable) vision model and run
 *     the pure {@link processExtractionResult} pipeline (validate → sanitize → reconcile →
 *     gate → associate).
 *  3. Upsert each produced record keyed by its deterministic idempotency id so re-running
 *     the same source ref updates in place instead of duplicating.
 *
 * Returns counts of produced and flagged records plus any skipped malformed items.
 */
export async function processPyqExtractionJob(
    data: PyqExtractionJobData,
    deps: PyqExtractionDeps,
): Promise<PyqExtractionJobResult> {
    const { extractor, db } = deps;

    const answerKeyRow = await db.answerKey.findUnique({
        where: { id: data.answerKeyId },
        select: { entries: true },
    });
    const officialKey: OfficialAnswerKey = parseOfficialAnswerKey(answerKeyRow?.entries ?? {});

    const association: ExtractionAssociation = {
        examTrack: data.examTrack,
        year: data.year,
        subjectId: data.subjectId,
    };
    const paperId = data.paperId ?? null;

    let produced = 0;
    let flaggedForReview = 0;
    const failures: ExtractionFailure[] = [];

    for (const sourceImageRef of data.sourceImageRefs) {
        const result = await extractor.extractQuestionsFromImage({
            sourceImageRef,
            examTrack: association.examTrack,
            year: association.year,
            subjectId: association.subjectId,
        });

        const outcome = processExtractionResult(
            result,
            association,
            officialKey,
            sourceImageRef,
            paperId,
        );
        failures.push(...outcome.failures);

        for (const record of outcome.records) {
            await db.pYQ.upsert({
                where: { id: record.id },
                create: toCreateInput(record),
                update: toUpdateInput(record),
            });
            produced += 1;
            if (record.flaggedForReview) {
                flaggedForReview += 1;
            }
        }
    }

    return { produced, flaggedForReview, failures };
}

/**
 * Construct the live BullMQ worker that consumes the `pyq-extraction` queue. Reuses the
 * shared Redis connection from the queue lib and the concrete collaborators by default.
 *
 * This is intentionally NOT invoked at import time (constructing a `Worker` would open a
 * Redis connection), so importing this module stays side-effect free for tests and
 * `next build`. A process entry point calls this to start consuming.
 */
export function createPyqExtractionWorker(deps: PyqExtractionDeps): Worker {
    return new Worker(
        QUEUE_NAMES.PYQ_EXTRACTION,
        async (job: Job<PyqExtractionJobData>): Promise<PyqExtractionJobResult> =>
            processPyqExtractionJob(job.data, deps),
        { connection: getRedisConnection() },
    );
}
