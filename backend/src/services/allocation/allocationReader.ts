/**
 * Allocation Service reader (task 9.1; design "Service layer → `allocationReader.ts`";
 * Req 8.2, 9.1, 9.2, 9.4, 10.2).
 *
 * This is the single data-access seam for the Weightage-Based Time Allocation feature.
 * Following the established Phase 1 / Performance Analytics layering convention (see
 * `src/services/analytics/weakAreaService.ts`, `topicPriorityService.ts`), it reads the
 * already-persisted rows through the Prisma client singleton (`@/lib/db`), shapes them into
 * the plain, DB-free inputs the pure `src/lib/allocation/*` modules consume, and delegates
 * ALL computation to that pure layer. It performs only reads against existing models — no
 * create/update/delete against any `Profile`, `Chapter`, `PYQAttempt`, `QuestionTopicMap`, or
 * `TopicFrequencyReferenceData` row (Req 9.4).
 *
 * It exposes two entry points so the thin service handlers (tasks 10–12) can follow the
 * pipeline of the design sequence diagram — read Profile, resolve the active reference year,
 * then read the rest:
 *
 *   1. {@link readAllocationProfile} — the requesting user's `Profile` slice (`examTrack`,
 *      `language`, `subscriptionTier`) used for reference-version selection, localization, and
 *      tier gating (Req 10, 11, 12). Returns `null` when the user has no profile (not
 *      onboarded), letting the handler return `404 NOT_FOUND`.
 *   2. {@link readAllocationData} — the user's Chapters (with `Weightage_Override` precedence
 *      already applied, Req 8.2), the user's `PYQAttempt` per-question outcomes (parsed
 *      defensively from the `perQuestion` Json into {@link AttemptQuestionOutcome}[]), the
 *      `QuestionTopicMap` links for exactly the referenced questions, and the active-year
 *      `TopicFrequencyReferenceData` records for the user's track.
 *
 * Per-user isolation (Req 10.2): every user-owned query is scoped by `userId`, so an output is
 * computed using only the requesting user's data together with the system-supplied
 * `QuestionTopicMap` and `TopicFrequencyReferenceData` (which are global reference data,
 * identical for all users of a track). No row owned by another user is ever read.
 *
 * Source constraint (Req 9.1, 9.2): the only inputs are the persisted Phase 1 `PYQAttempt` and
 * `Chapter` rows, the Performance Analytics `QuestionTopicMap` and `TopicFrequencyReferenceData`
 * reference data, and the requesting user's `Profile` — no external service, file, or other
 * store is read.
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { ExamTrack } from '@/lib/reference';
import type { LanguagePref, SubscriptionTier } from '@prisma/client';

import type {
    AllocationChapter,
    AttemptQuestionOutcome,
    ChapterStatus,
    QuestionTopicLink,
    TopicFrequencyRecord,
} from '@/lib/allocation/frequency';

/**
 * The requesting user's `Profile` slice this feature needs: the Exam_Track drives
 * reference-version selection (Req 2.2) and the topic-frequency join (Req 2.1); the
 * Language_Preference drives localization (Req 11); the Subscription_Tier drives tier gating
 * (Req 12).
 */
export interface AllocationProfile {
    examTrack: ExamTrack;
    language: LanguagePref;
    subscriptionTier: SubscriptionTier;
}

/**
 * A Chapter shaped for the allocation pipeline: the minimal {@link AllocationChapter} the
 * frequency/signal math consumes, augmented with the User Time_Allocation_Override the
 * suggested-allocation step honors (Req 8.1, 8.5). The `weightage` already reflects
 * `Weightage_Override` precedence (Req 8.2).
 */
export interface AllocationReaderChapter extends AllocationChapter {
    /** A User Time_Allocation_Override share for this Chapter, if any (Req 8.1, 8.5). */
    timeAllocationOverride: number | null;
}

/**
 * The complete set of pure-layer inputs read for one allocation computation: the user's
 * Chapters, their PYQ per-question outcomes, the `QuestionTopicMap` links for the referenced
 * questions, and the active-year `TopicFrequencyReferenceData` records for the track.
 */
export interface AllocationData {
    chapters: AllocationReaderChapter[];
    outcomes: AttemptQuestionOutcome[];
    links: QuestionTopicLink[];
    frequencyRecords: TopicFrequencyRecord[];
}

/**
 * Coerce a persisted Prisma `Json` `perQuestion` value into typed
 * {@link AttemptQuestionOutcome}[] entries, skipping malformed elements (Req 9.4 read-only,
 * defensive). A non-array Json value degrades to an empty array rather than throwing, so an
 * attempt with unexpected stored data simply contributes no outcomes. Only `questionId` is
 * extracted: the PYQ_Chapter_Frequency count is of attempted-question *presence*, not outcome
 * correctness (Req 1.1).
 */
function asAttemptOutcomes(perQuestion: unknown): AttemptQuestionOutcome[] {
    if (!Array.isArray(perQuestion)) {
        return [];
    }
    const outcomes: AttemptQuestionOutcome[] = [];
    for (const raw of perQuestion) {
        if (raw !== null && typeof raw === 'object') {
            const questionId = (raw as Record<string, unknown>).questionId;
            if (typeof questionId === 'string') {
                outcomes.push({ questionId });
            }
        }
    }
    return outcomes;
}

/**
 * Read the requesting user's `Profile` slice used for version selection, localization, and tier
 * gating (Req 10, 11, 12). Scoped by `ctx.user.id` (Req 10.2); read-only (Req 9.4).
 *
 * @param ctx The authenticated request context.
 * @returns The {@link AllocationProfile}, or `null` when the user has no profile (not
 *   onboarded) so the handler can return `404 NOT_FOUND`.
 */
export async function readAllocationProfile(
    ctx: AuthContext,
): Promise<AllocationProfile | null> {
    const profile = await prisma.profile.findUnique({
        where: { userId: ctx.user.id },
        select: { examTrack: true, language: true, subscriptionTier: true },
    });

    if (!profile) {
        return null;
    }

    return {
        examTrack: profile.examTrack,
        language: profile.language,
        subscriptionTier: profile.subscriptionTier,
    };
}

/**
 * Read the pure-layer inputs for one allocation computation (Req 8.2, 9.1, 9.2, 9.4, 10.2).
 *
 * All user-owned reads are scoped by `ctx.user.id` (Req 10.2). The Chapters' effective
 * `weightage` applies `Weightage_Override` precedence (`weightageOverride ?? weightage`) before
 * the value reaches the pure layer (Req 8.2), and each Chapter carries through its
 * `weightageIsDefault` flag (Req 6.3) and any `timeAllocationOverride` (Req 8.1). The
 * `QuestionTopicMap` is queried only for the questions the user actually attempted, and the
 * `TopicFrequencyReferenceData` is read for the active `referenceDataYear` the caller resolved
 * (Req 2.1, 2.2). Every query is read-only; no existing row is created, updated, or deleted
 * (Req 9.4).
 *
 * @param ctx The authenticated request context (scopes user-owned queries).
 * @param examTrack The user's Exam_Track, selecting the topic-frequency dataset (Req 2.1).
 * @param referenceDataYear The active reference year resolved via `resolveActiveReferenceYear`
 *   (Req 2.2); selects the active-year `TopicFrequencyReferenceData` rows.
 * @returns The {@link AllocationData} bundle handed to the pure `lib/allocation` modules.
 */
export async function readAllocationData(
    ctx: AuthContext,
    examTrack: ExamTrack,
    referenceDataYear: number,
): Promise<AllocationData> {
    const userId = ctx.user.id;

    // User-owned Chapters and PYQ attempts, both scoped by userId (Req 10.2). The
    // active-year topic-frequency reference data is system-supplied (global per track), so it
    // carries no user scope. All three queries are reads only (Req 9.4).
    const [chapterRows, pyqAttemptRows, frequencyRows] = await Promise.all([
        prisma.chapter.findMany({
            where: { userId },
            select: {
                id: true,
                referenceKey: true,
                status: true,
                weightage: true,
                weightageIsDefault: true,
                weightageOverride: true,
                timeAllocationOverride: true,
            },
        }),
        prisma.pYQAttempt.findMany({
            where: { userId },
            select: { perQuestion: true },
        }),
        prisma.topicFrequencyReferenceData.findMany({
            where: { examTrack, referenceDataYear },
            select: { topicKey: true, avgQuestionsPerYear: true },
        }),
    ]);

    // Apply Weightage_Override precedence before the value reaches the pure layer (Req 8.2):
    // the effective weightage is the override when set, else the Phase 1 weightage.
    const chapters: AllocationReaderChapter[] = chapterRows.map((row) => ({
        id: row.id,
        referenceKey: row.referenceKey,
        status: row.status as ChapterStatus,
        weightage: row.weightageOverride ?? row.weightage,
        weightageIsDefault: row.weightageIsDefault,
        timeAllocationOverride: row.timeAllocationOverride,
    }));

    // Flatten every attempt's per-question outcomes into a single owned outcome list (Req 1.1,
    // 1.4); parsing is defensive so malformed stored Json never throws (Req 9.4).
    const outcomes: AttemptQuestionOutcome[] = pyqAttemptRows.flatMap((row) =>
        asAttemptOutcomes(row.perQuestion),
    );

    // Resolve QuestionTopicMap links for exactly the referenced questions. A question with no
    // map entry contributes to no Chapter (Req 1.2); querying only attempted questions keeps
    // the read minimal. QuestionTopicMap is global reference data (no user scope).
    const questionIds = [...new Set(outcomes.map((outcome) => outcome.questionId))];
    const linkRows =
        questionIds.length > 0
            ? await prisma.questionTopicMap.findMany({
                where: { questionId: { in: questionIds } },
                select: { questionId: true, topicKey: true },
            })
            : [];

    const links: QuestionTopicLink[] = linkRows.map((row) => ({
        questionId: row.questionId,
        topicKey: row.topicKey,
    }));

    const frequencyRecords: TopicFrequencyRecord[] = frequencyRows.map((row) => ({
        topicKey: row.topicKey,
        avgQuestionsPerYear: row.avgQuestionsPerYear,
    }));

    return { chapters, outcomes, links, frequencyRecords };
}
