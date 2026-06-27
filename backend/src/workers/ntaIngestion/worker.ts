/**
 * The `nta-ingestion` BullMQ worker (Req 20.1–20.4, 20.6).
 *
 * A repeatable (cron-style) job that:
 *  1. fetches raw, untrusted announcement items from an {@link NtaSource} (Req 20.1);
 *  2. parses, validates, and SANITIZES each item, SKIPPING malformed ones without
 *     failing the batch (Req 20.2, 20.3);
 *  3. de-duplicates by `dedupeHash` so only one copy is stored (Req 20.4); and
 *  4. on an exam-date change, updates affected users' `Target_Exam_Date` and recomputes
 *     `Target_Completion_Date` + countdown (Req 20.6).
 *
 * The orchestration ({@link runNtaIngestion}) is decoupled from BullMQ/Prisma/Redis via
 * the injected {@link NtaSource} and {@link NtaIngestionPrisma} so it can be driven with
 * fixtures and a mocked database in tests — no live network/Redis/DB is required. The
 * pure helpers (sanitize, dedupe-hash, parse/validate, exam-date recompute) live in
 * sibling modules and are unit-tested directly.
 */
import { Worker, type Job } from 'bullmq';

import { prisma } from '@/lib/db';
import { getNtaIngestionQueue, getRedisConnection, QUEUE_NAMES } from '@/lib/queue';
import type { ExamTrack } from '@/lib/reference';

import { applyExamDateChange, type ProfileExamUpdate } from './examDate';
import { parseAndValidate } from './parse';
import { examScopeToTrack, type NtaSource, type SanitizedAnnouncement } from './types';

/** The repeatable job's name on the `nta-ingestion` queue. */
export const NTA_INGESTION_JOB_NAME = 'ingest';

/** Default cadence for the repeatable ingestion job: hourly. */
export const DEFAULT_INGESTION_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The narrow slice of the Prisma client the worker needs. Declaring it structurally
 * (rather than depending on the concrete `PrismaClient`) lets tests pass a lightweight
 * mock while the real client satisfies the same shape.
 */
export interface NtaIngestionPrisma {
    nTAAnnouncement: {
        findUnique(args: {
            where: { dedupeHash: string };
        }): Promise<{ id: string } | null>;
        create(args: {
            data: {
                examScope: string;
                title: string;
                body: string;
                publishedAt: Date;
                dedupeHash: string;
                affectsExamDate: boolean;
                newExamDate: Date | null;
            };
        }): Promise<{ id: string }>;
    };
    profile: {
        findMany(args: {
            where: { examTrack: ExamTrack };
            select: { userId: true; revisionBufferDays: true };
        }): Promise<Array<{ userId: string; revisionBufferDays: number }>>;
        update(args: {
            where: { userId: string };
            data: { targetExamDate: Date };
        }): Promise<unknown>;
    };
}

/** Dependencies for {@link runNtaIngestion}. */
export interface NtaIngestionDeps {
    prisma: NtaIngestionPrisma;
    /** The reference "now" used to recompute countdowns. Defaults to the current time. */
    now?: Date;
}

/** Summary of one ingestion run, useful for logging and tests. */
export interface IngestionResult {
    /** Total raw items fetched from the source. */
    fetched: number;
    /** New announcements stored this run. */
    stored: number;
    /** Items skipped because they were malformed/unparseable (Req 20.3). */
    skippedMalformed: number;
    /** Items collapsed/ignored as duplicates of an existing or in-batch item (Req 20.4). */
    duplicates: number;
    /** Per-user exam-date recomputations applied this run (Req 20.6). */
    examDateUpdates: ProfileExamUpdate[];
}

/** True when an error is a Prisma unique-constraint violation (`P2002`). */
function isUniqueViolation(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002'
    );
}

/**
 * Run a single ingestion pass against the given source.
 *
 * Pure orchestration over injected dependencies: each step (parse/skip, de-dup, store,
 * propagate exam-date change) is isolated so a single bad item never aborts the batch
 * (Req 20.3) and re-running with the same input stores nothing new (idempotent by
 * `dedupeHash`).
 */
export async function runNtaIngestion(
    source: NtaSource,
    deps: NtaIngestionDeps,
): Promise<IngestionResult> {
    const now = deps.now ?? new Date();
    const rawItems = await source.fetchAnnouncements();

    // 1. Parse + validate + sanitize; skip malformed items (Req 20.2/20.3).
    const valid: SanitizedAnnouncement[] = [];
    let skippedMalformed = 0;
    for (const raw of rawItems) {
        const result = parseAndValidate(raw);
        if (result.ok) {
            valid.push(result.value);
        } else {
            skippedMalformed += 1;
        }
    }

    // 2. Collapse in-batch duplicates by dedupeHash (last occurrence wins) (Req 20.4).
    const byHash = new Map<string, SanitizedAnnouncement>();
    let duplicates = 0;
    for (const announcement of valid) {
        if (byHash.has(announcement.dedupeHash)) {
            duplicates += 1;
        }
        byHash.set(announcement.dedupeHash, announcement);
    }

    // 3. Store new announcements; existing dedupeHashes are duplicates (idempotent).
    let stored = 0;
    const examDateChanges: SanitizedAnnouncement[] = [];
    for (const announcement of byHash.values()) {
        const existing = await deps.prisma.nTAAnnouncement.findUnique({
            where: { dedupeHash: announcement.dedupeHash },
        });
        if (existing !== null) {
            duplicates += 1;
            continue;
        }
        try {
            await deps.prisma.nTAAnnouncement.create({
                data: {
                    examScope: announcement.examScope,
                    title: announcement.title,
                    body: announcement.body,
                    publishedAt: announcement.publishedAt,
                    dedupeHash: announcement.dedupeHash,
                    affectsExamDate: announcement.affectsExamDate,
                    newExamDate: announcement.newExamDate,
                },
            });
            stored += 1;
            if (announcement.affectsExamDate && announcement.newExamDate !== null) {
                examDateChanges.push(announcement);
            }
        } catch (error) {
            // A concurrent run may have inserted the same dedupeHash first; treat the
            // unique-constraint violation as a duplicate rather than failing the batch.
            if (isUniqueViolation(error)) {
                duplicates += 1;
                continue;
            }
            throw error;
        }
    }

    // 4. Propagate exam-date changes to affected users (Req 20.6).
    const examDateUpdates: ProfileExamUpdate[] = [];
    for (const announcement of examDateChanges) {
        const newExamDate = announcement.newExamDate as Date;
        const track = examScopeToTrack(announcement.examScope);
        const profiles = await deps.prisma.profile.findMany({
            where: { examTrack: track },
            select: { userId: true, revisionBufferDays: true },
        });
        const updates = applyExamDateChange(profiles, newExamDate, now);
        for (const update of updates) {
            await deps.prisma.profile.update({
                where: { userId: update.userId },
                data: { targetExamDate: update.targetExamDate },
            });
            examDateUpdates.push(update);
        }
    }

    return { fetched: rawItems.length, stored, skippedMalformed, duplicates, examDateUpdates };
}

/**
 * Construct the BullMQ worker that consumes the `nta-ingestion` queue, processing each
 * job with {@link runNtaIngestion} against the live Prisma client. The `source` is
 * supplied by the caller (production wires the concrete RSS/scraper adapter).
 *
 * Importing this module does not open a Redis connection; the connection is established
 * only when this factory is invoked.
 */
export function createNtaIngestionWorker(source: NtaSource): Worker {
    return new Worker(
        QUEUE_NAMES.NTA_INGESTION,
        async (_job: Job): Promise<IngestionResult> =>
            runNtaIngestion(source, { prisma: prisma as unknown as NtaIngestionPrisma }),
        { connection: getRedisConnection() },
    );
}

/**
 * Register the repeatable ingestion job on the `nta-ingestion` queue (Req 20.1).
 *
 * Uses a stable `jobId` so repeated calls (e.g. on every server boot) reconfigure the
 * single repeatable schedule rather than stacking duplicates.
 */
export async function scheduleNtaIngestion(
    intervalMs: number = DEFAULT_INGESTION_INTERVAL_MS,
): Promise<void> {
    await getNtaIngestionQueue().add(
        NTA_INGESTION_JOB_NAME,
        {},
        {
            jobId: 'nta-ingestion-repeatable',
            repeat: { every: intervalMs },
            removeOnComplete: true,
            removeOnFail: 100,
        },
    );
}
