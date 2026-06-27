/**
 * Weak-Area Service handler (task 23.1; design "Weak-Area endpoint", Req 11, 12, 13;
 * Req 11.1, 11.3, 11.5, 12.2, 13.1, 14.2).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/analytics/weak-areas
 *     -> 200 { weakAreas, sessionTypeDistribution }   scoped to the requesting user
 *
 * The handler is intentionally THIN, mirroring the Phase 1 read-service convention
 * (`dashboardService.ts`, `scoreTrajectoryService.ts`): it loads the authenticated user's
 * persisted Phase 1 rows via Prisma — every query scoped by `userId` so the output is
 * computed using only data owned by the requesting user (Req 14.2) — joins each per-question
 * outcome to its `subjectId` (via `PYQ`) and, when available, its `topicKey` (via
 * `QuestionTopicMap`), then delegates ALL aggregation, scoring, and ranking to the pure,
 * database-free {@link computeWeakAreas} (design layering: route → thin service → pure
 * module). It performs no writes against any Phase 1 model, reading them unaltered
 * (Req 11.5, 13.1).
 *
 * Two entry points are exported:
 *   - {@link getWeakAreaResult} — returns the FULL {@link ScoredWeakAreaResult}, including
 *     the per-Topic `weakAreaScoreByTopic` map, so the topic-priority service (task 20.1)
 *     can consume the per-Topic scores without re-reading or recomputing (Req 12.2).
 *   - {@link weakAreasHandler} — the thin `withAuth`-shaped handler that serializes only the
 *     `{ weakAreas, sessionTypeDistribution }` slice the endpoint surfaces (design
 *     "Weak-Area endpoint").
 *
 * The route file (task 26.6) wraps {@link weakAreasHandler} with `withAuth`, which rejects
 * unauthenticated requests with 401 UNAUTHORIZED before the handler runs (Req 14.1).
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { QuestionOutcome } from '@/lib/scoring/score';

import {
    computeWeakAreas,
    type MistakeCategory,
    type ScoredWeakAreaResult,
    type WeakAreaFocusSessionRow,
    type WeakAreaMistakeRow,
    type WeakAreaOutcomeRow,
    type SessionType,
} from './weakArea';

/** One persisted per-question entry from a `PYQAttempt`/`TimedPaperAttempt` `perQuestion` Json. */
interface PerQuestionEntry {
    questionId: string;
    outcome: QuestionOutcome;
}

/**
 * Coerce a persisted Prisma `Json` `perQuestion` value into a typed array of
 * `{ questionId, outcome }` entries, skipping malformed elements. A non-array Json value
 * degrades to an empty array rather than throwing, so an attempt with unexpected stored data
 * simply contributes no outcomes (read-only, defensive).
 */
function asPerQuestionEntries(perQuestion: unknown): PerQuestionEntry[] {
    if (!Array.isArray(perQuestion)) {
        return [];
    }
    const entries: PerQuestionEntry[] = [];
    for (const raw of perQuestion) {
        if (raw !== null && typeof raw === 'object') {
            const record = raw as Record<string, unknown>;
            const questionId = record.questionId;
            const outcome = record.outcome;
            if (typeof questionId === 'string' && typeof outcome === 'string') {
                entries.push({ questionId, outcome: outcome as QuestionOutcome });
            }
        }
    }
    return entries;
}

/**
 * Load the requesting user's persisted Phase 1 signals, join per-question outcomes to their
 * `subjectId`/`topicKey`, and compute the full scored weak-area result (Req 11.1–11.5, 12.1–12.3).
 *
 * Reusable across endpoints: the Weak-Area endpoint serializes a slice of this, while the
 * topic-priority service consumes the `weakAreaScoreByTopic` map (Req 12.2). Reads only;
 * never writes a Phase 1 row (Req 11.5, 13.1, 13.2).
 *
 * @param userId - the authenticated user's id; scopes every query for per-user isolation
 *   (Req 14.2).
 */
export async function getWeakAreaResult(userId: string): Promise<ScoredWeakAreaResult> {
    // Load the user's persisted Phase 1 signals, each scoped by userId (Req 14.2). The
    // analytics path issues only reads — no UPDATE/DELETE — against these Phase 1 models
    // (Req 11.5, 13.1, 13.2).
    const [pyqAttemptRows, timedAttemptRows, mistakeRows, focusSessionRows] = await Promise.all([
        prisma.pYQAttempt.findMany({ where: { userId }, select: { perQuestion: true } }),
        prisma.timedPaperAttempt.findMany({ where: { userId }, select: { perQuestion: true } }),
        prisma.mistakeJournalEntry.findMany({
            where: { userId },
            select: { questionId: true, subjectId: true, category: true },
        }),
        prisma.focusSession.findMany({
            where: { userId },
            select: { sessionType: true, focusedDurationMin: true },
        }),
    ]);

    // Flatten every attempt's per-question outcomes into a single list of (questionId, outcome).
    const perQuestionEntries: PerQuestionEntry[] = [
        ...pyqAttemptRows,
        ...timedAttemptRows,
    ].flatMap((row) => asPerQuestionEntries(row.perQuestion));

    // Resolve the joins needed to attribute each row to a Subject and (when mapped) a Topic.
    // Question ids come from both the attempt outcomes and the mistake-journal entries.
    const questionIds = [
        ...new Set([
            ...perQuestionEntries.map((entry) => entry.questionId),
            ...mistakeRows.map((row) => row.questionId),
        ]),
    ];

    // questionId -> subjectId (via PYQ) and questionId -> topicKey (via QuestionTopicMap). Both
    // are global reference joins; QuestionTopicMap is additive and leaves PYQ untouched
    // (Req 13.3). A question with no QuestionTopicMap entry contributes only at Subject level.
    const [pyqRows, topicMapRows] =
        questionIds.length > 0
            ? await Promise.all([
                prisma.pYQ.findMany({
                    where: { id: { in: questionIds } },
                    select: { id: true, subjectId: true },
                }),
                prisma.questionTopicMap.findMany({
                    where: { questionId: { in: questionIds } },
                    select: { questionId: true, topicKey: true },
                }),
            ])
            : [[], []];

    const subjectIdByQuestion = new Map(pyqRows.map((row) => [row.id, row.subjectId]));
    const topicKeyByQuestion = new Map(topicMapRows.map((row) => [row.questionId, row.topicKey]));

    // Resolve display names: Subject.name (global, by id) and the user's Chapter.name keyed by
    // referenceKey (== topicKey). These are optional labels; an unresolved name is left null
    // and the pure module degrades gracefully.
    const subjectIds = [
        ...new Set([
            ...subjectIdByQuestion.values(),
            ...mistakeRows.map((row) => row.subjectId),
        ]),
    ];
    const topicKeys = [...new Set(topicKeyByQuestion.values())];

    const [subjectRows, chapterRows] = await Promise.all([
        subjectIds.length > 0
            ? prisma.subject.findMany({
                where: { id: { in: subjectIds } },
                select: { id: true, name: true },
            })
            : Promise.resolve([]),
        topicKeys.length > 0
            ? prisma.chapter.findMany({
                where: { userId, referenceKey: { in: topicKeys } },
                select: { referenceKey: true, name: true },
            })
            : Promise.resolve([]),
    ]);

    const subjectNameById = new Map(subjectRows.map((row) => [row.id, row.name]));
    const topicNameByKey = new Map(chapterRows.map((row) => [row.referenceKey, row.name]));

    // Build the database-free row shapes the pure module consumes. Attempt outcomes that
    // cannot be attributed to a Subject (no PYQ row for the question id) are dropped, since a
    // weak area requires a Subject key.
    const outcomes: WeakAreaOutcomeRow[] = [];
    for (const entry of perQuestionEntries) {
        const subjectId = subjectIdByQuestion.get(entry.questionId);
        if (subjectId === undefined) {
            continue;
        }
        const topicKey = topicKeyByQuestion.get(entry.questionId) ?? null;
        outcomes.push({
            subjectId,
            subjectName: subjectNameById.get(subjectId) ?? null,
            topicKey,
            topicName: topicKey !== null ? topicNameByKey.get(topicKey) ?? null : null,
            outcome: entry.outcome,
        });
    }

    const mistakes: WeakAreaMistakeRow[] = mistakeRows.map((row) => {
        const topicKey = topicKeyByQuestion.get(row.questionId) ?? null;
        return {
            subjectId: row.subjectId,
            subjectName: subjectNameById.get(row.subjectId) ?? null,
            topicKey,
            topicName: topicKey !== null ? topicNameByKey.get(topicKey) ?? null : null,
            category: row.category as MistakeCategory,
        };
    });

    const focusSessions: WeakAreaFocusSessionRow[] = focusSessionRows.map((row) => ({
        sessionType: row.sessionType as SessionType,
        focusedDurationMin: row.focusedDurationMin,
    }));

    return computeWeakAreas({ outcomes, mistakes, focusSessions });
}

/**
 * GET /api/analytics/weak-areas
 *
 * Thin handler: delegates to {@link getWeakAreaResult} for the authenticated user and
 * serializes the `{ weakAreas, sessionTypeDistribution }` slice the endpoint surfaces. The
 * per-Topic `weakAreaScoreByTopic` map is intentionally not part of this payload; it is an
 * internal input to topic prioritization (Req 12.2). Expects an authenticated
 * {@link AuthContext}; the route file wraps this with `withAuth` (Req 14.1).
 */
export async function weakAreasHandler(
    _request: Request,
    ctx: AuthContext,
): Promise<Response> {
    const { weakAreas, sessionTypeDistribution } = await getWeakAreaResult(ctx.user.id);
    return Response.json({ weakAreas, sessionTypeDistribution });
}
