/**
 * Offline-sync handler (task 18.1; design "Offline Sync Handler", "Idempotent Offline Sync
 * Reconciliation"; Req 21.5).
 *
 *   POST /api/sync
 *     body: { records: LocalSyncRecord[] }
 *     -> 200 { results: [{ clientId, serverId, status: "CREATED"|"DUPLICATE", score? }] }
 *     -> 422 VALIDATION_ERROR (bad body / payload)
 *
 * The client's outbox is one-directional (client -> server) for captured activity. For each
 * record the handler reconciles idempotently keyed by `(userId, clientId)`:
 *
 *   - DUPLICATE: a `LocalSyncRecord` already exists for `(userId, clientId)`. The handler
 *     returns the existing `serverId` and creates NOTHING (Req 21.5).
 *   - CREATED: the handler creates the target row (focus session / PYQ attempt / timed
 *     attempt), computes the authoritative score SERVER-SIDE where applicable (PYQ/timed
 *     via the shared pure scoring against the stored answer key — never trusting any
 *     client-supplied correctness), writes the ledger row, and returns `serverId` + score.
 *
 * Each create + ledger-write runs in a single transaction so a target row and its ledger
 * row are committed atomically. The `@@unique([userId, clientId])` constraint on BOTH the
 * target table and the ledger table is the final backstop against a concurrent double
 * insert: if two requests race the same `clientId`, one create raises `P2002` and the
 * handler resolves the now-existing ledger row and reports `DUPLICATE` instead.
 *
 * The pure idempotency decision lives in {@link decideSyncAction} (testable in isolation);
 * the per-type payload validation lives in {@link validateSyncInput}; this module wires
 * them to Prisma, server-side scoring, and per-user scoping.
 */
import { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import {
    scorePyqAttempt,
    type PyqAnswerSource,
} from '@/services/pyq/pyqAttemptService';
import {
    scoreTimedAttempt,
    type PaperAnswerSource,
} from '@/services/timedPaper/timedPaperAttemptService';

import { decideSyncAction, type SyncRecordResult } from './syncReconciliation';
import { validateSyncInput, type ValidatedSyncRecord } from './syncValidation';

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/** The result of creating a target row: its canonical server id and optional score. */
interface CreatedTarget {
    serverId: string;
    score?: number;
}

/**
 * Load the referenced PYQ rows (id + correctOption) for a synced PYQ attempt, so the answer
 * key is resolved server-side rather than trusted from the client. Read-only, so it runs
 * outside the create transaction.
 */
async function loadPyqAnswerSources(
    answers: ReadonlyArray<{ questionId: string }>,
): Promise<PyqAnswerSource[]> {
    const questionIds = [...new Set(answers.map((answer) => answer.questionId))];
    if (questionIds.length === 0) {
        return [];
    }
    return prisma.pYQ.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, correctOption: true },
    });
}

/**
 * Load a paper's practice-eligible PYQ rows (id + correctOption) for a synced timed attempt
 * so EVERY question of the paper is scored server-side (Req 19.5). Read-only, so it runs
 * outside the create transaction.
 */
async function loadPaperAnswerSources(paperId: string): Promise<PaperAnswerSource[]> {
    return prisma.pYQ.findMany({
        where: { paperId, flaggedForReview: false },
        select: { id: true, correctOption: true },
        orderBy: { id: 'asc' },
    });
}

/**
 * Create the target row for one validated record and its ledger row in a single
 * transaction, returning the canonical server id and (for scored types) the authoritative
 * score. The record's envelope `clientId` is stamped on both the target row and the ledger
 * row so the `@@unique([userId, clientId])` constraint backstops concurrent inserts.
 */
async function createTargetAndLedger(
    userId: string,
    record: ValidatedSyncRecord,
): Promise<CreatedTarget> {
    switch (record.type) {
        case 'FOCUS_SESSION': {
            const { payload, clientId } = record;
            const serverId = await prisma.$transaction(async (tx) => {
                const session = await tx.focusSession.create({
                    data: {
                        userId,
                        subjectId: payload.subjectId,
                        startTime: payload.startTime,
                        endTime: payload.endTime,
                        focusedDurationMin: payload.focusedDurationMin,
                        sessionType: payload.sessionType,
                        clientId,
                    },
                    select: { id: true },
                });
                await tx.localSyncRecord.create({
                    data: { userId, clientId, type: 'FOCUS_SESSION', serverId: session.id },
                });
                return session.id;
            });
            return { serverId };
        }

        case 'PYQ_ATTEMPT': {
            const { payload, clientId } = record;
            // Resolve the answer key SERVER-SIDE (never trust the client) and score.
            const questions = await loadPyqAnswerSources(payload.answers);
            const { perQuestion, totalScore } = scorePyqAttempt(payload.answers, questions);
            const serverId = await prisma.$transaction(async (tx) => {
                const attempt = await tx.pYQAttempt.create({
                    data: {
                        userId,
                        paperOrSetRef: payload.paperOrSetRef,
                        answers: payload.answers as unknown as Prisma.InputJsonValue,
                        perQuestion: perQuestion as unknown as Prisma.InputJsonValue,
                        totalScore,
                        clientId,
                    },
                    select: { id: true },
                });
                await tx.localSyncRecord.create({
                    data: { userId, clientId, type: 'PYQ_ATTEMPT', serverId: attempt.id },
                });
                return attempt.id;
            });
            return { serverId, score: totalScore };
        }

        case 'TIMED_PAPER_ATTEMPT': {
            const { payload, clientId } = record;
            // Resolve the answer key SERVER-SIDE from the full paper and score every question.
            const questions = await loadPaperAnswerSources(payload.paperId);
            const { perQuestion, totalScore } = scoreTimedAttempt(payload.answers, questions);
            const serverId = await prisma.$transaction(async (tx) => {
                const attempt = await tx.timedPaperAttempt.create({
                    data: {
                        userId,
                        paperId: payload.paperId,
                        perQuestion: perQuestion as unknown as Prisma.InputJsonValue,
                        totalScore,
                        timeTakenSec: payload.timeTakenSec,
                        clientId,
                    },
                    select: { id: true },
                });
                await tx.localSyncRecord.create({
                    data: {
                        userId,
                        clientId,
                        type: 'TIMED_PAPER_ATTEMPT',
                        serverId: attempt.id,
                    },
                });
                return attempt.id;
            });
            return { serverId, score: totalScore };
        }
    }
}

/**
 * Resolve the `serverId` recorded for an already-synced `(userId, clientId)` pair. Used as
 * the concurrency backstop: when a create races and hits the unique constraint, the ledger
 * row now exists and its `serverId` is the canonical id to report as `DUPLICATE`.
 */
async function resolveExistingServerId(
    userId: string,
    clientId: string,
): Promise<string | null> {
    const row = await prisma.localSyncRecord.findUnique({
        where: { userId_clientId: { userId, clientId } },
        select: { serverId: true },
    });
    return row?.serverId ?? null;
}

/**
 * Handle `POST /api/sync`. Validates the outbox, preloads the ledger rows already recorded
 * for this user, then reconciles each record idempotently. The route file wraps this with
 * `withAuth` so unauthenticated requests are rejected upstream, and every read/write is
 * scoped to `auth.user.id`.
 */
export async function syncHandler(request: Request, auth: AuthContext): Promise<Response> {
    const body = await readJsonBody(request);

    const validation = validateSyncInput(body);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const userId = auth.user.id;
    const { records } = validation.value;

    // Preload the ledger rows already recorded for this user so the common (already-synced)
    // path is a pure map lookup; the per-create unique constraint remains the final backstop.
    const clientIds = [...new Set(records.map((record) => record.clientId))];
    const existingRows =
        clientIds.length === 0
            ? []
            : await prisma.localSyncRecord.findMany({
                where: { userId, clientId: { in: clientIds } },
                select: { clientId: true, serverId: true },
            });
    const existingByClientId = new Map(
        existingRows.map((row) => [row.clientId, row.serverId] as const),
    );

    const results: SyncRecordResult[] = [];
    for (const record of records) {
        const decision = decideSyncAction(existingByClientId, record.clientId);
        if (decision.action === 'DUPLICATE') {
            results.push({
                clientId: record.clientId,
                serverId: decision.serverId,
                status: 'DUPLICATE',
            });
            continue;
        }

        try {
            const created = await createTargetAndLedger(userId, record);
            // Fold the freshly-created clientId back in so a repeated clientId later in the
            // same batch reconciles to DUPLICATE rather than attempting a second create.
            existingByClientId.set(record.clientId, created.serverId);
            results.push({
                clientId: record.clientId,
                serverId: created.serverId,
                status: 'CREATED',
                ...(created.score !== undefined ? { score: created.score } : {}),
            });
        } catch (error) {
            // Concurrency backstop: a racing request already synced this clientId. Resolve
            // the now-existing ledger row and report DUPLICATE instead of failing.
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                const serverId = await resolveExistingServerId(userId, record.clientId);
                if (serverId !== null) {
                    existingByClientId.set(record.clientId, serverId);
                    results.push({
                        clientId: record.clientId,
                        serverId,
                        status: 'DUPLICATE',
                    });
                    continue;
                }
            }
            throw error;
        }
    }

    return Response.json({ results });
}
