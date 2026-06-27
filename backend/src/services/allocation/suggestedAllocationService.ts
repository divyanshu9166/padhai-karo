/**
 * Suggested_Time_Allocation service handler (task 11.1; design "Service layer →
 * `suggestedAllocationService.ts`" and the computation sequence diagram; Req 5.1–5.5,
 * 6.1, 6.4, 7.1, 8.1, 10.1).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/allocation/suggested-allocation
 *     -> 200 { referenceDataYear, allocations: ChapterAllocationShare[] }
 *     -> 404 NOT_FOUND                    (user has no profile / not onboarded)
 *     -> 503 REFERENCE_DATA_UNAVAILABLE   (no topic-frequency dataset for the track)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 / Performance Analytics layering
 * convention (see `src/services/analytics/topicPriorityService.ts`): it reads the
 * authenticated user's Profile, gates on Subscription_Tier through the shared analytics tier
 * gate, resolves the active topic-frequency dataset version, reads the pure-layer inputs
 * through {@link readAllocationData}, then delegates ALL math to the pure
 * `src/lib/allocation/*` modules:
 *
 *   1. {@link pyqChapterFrequency} — the user's own PYQ_Chapter_Frequency per Chapter (Req 1).
 *   2. {@link historicalChapterFrequency} — each Chapter's Historical_Chapter_Frequency from
 *      the active-year reference data (Req 2).
 *   3. {@link combinedWeightageSignal} — fuse + normalize into the Combined_Weightage_Signal
 *      (Req 3).
 *   4. {@link suggestedTimeAllocation} — distribute shares across pending Chapters, honoring
 *      User overrides and the Chapter_Weightage fallback (Req 5, 6, 8).
 *
 * The single write this feature performs is an upsert of the per-user
 * {@link SuggestedAllocationSnapshot} (the new Phase 2 model only) so timetable generation can
 * later consume the most recently computed suggestion without recomputation (Req 7.1). No
 * existing Phase 1 / Performance Analytics row is created, updated, or deleted (Req 9.4).
 *
 * Per-user isolation (Req 10.2): every user-owned read in {@link readAllocationData} and the
 * snapshot upsert are scoped by `ctx.user.id`; the topic-frequency reference data and
 * QuestionTopicMap are system-supplied and identical for all users of a track. The route file
 * wraps this handler with `withAuth`, rejecting unauthenticated requests with
 * `401 UNAUTHORIZED` before it runs (Req 10.1).
 *
 * Reference-data versioning (Req 3.6, 9.5): the active version is the maximum
 * `referenceDataYear` present for the track, resolved by
 * `resolveActiveReferenceYear(track, TOPIC_FREQUENCY)`. When no rows exist the resolver
 * returns `null` and this handler returns `503 REFERENCE_DATA_UNAVAILABLE`; the active year is
 * echoed in the 200 payload and persisted into the snapshot.
 */
import { Prisma, ReferenceDatasetType } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { resolveActiveReferenceYear } from '@/lib/analytics/referenceVersion';

import {
    historicalChapterFrequency,
    pyqChapterFrequency,
} from '@/lib/allocation/frequency';
import {
    combinedWeightageSignal,
    type ChapterSignalInput,
} from '@/lib/allocation/signal';
import {
    suggestedTimeAllocation,
    type SuggestedChapterInput,
} from '@/lib/allocation/allocation';

import { AnalyticsOutput, assertTierAllowed } from '@/services/analytics/tierGate';

import { readAllocationData, readAllocationProfile } from './allocationReader';

/**
 * Handle `GET /api/allocation/suggested-allocation`.
 *
 * Computes the Suggested_Time_Allocation across the user's pending Chapters, upserts the
 * per-user {@link SuggestedAllocationSnapshot} (new model only), and returns
 * `{ referenceDataYear, allocations }`.
 *
 * A user without a Profile has not completed onboarding, so the endpoint returns
 * `404 NOT_FOUND` directing them to onboard (consistent with `topicPriorityService`).
 */
export async function suggestedAllocationHandler(
    _request: Request,
    ctx: AuthContext,
): Promise<Response> {
    // Profile drives version selection (Exam_Track) and tier gating (Subscription_Tier).
    const profile = await readAllocationProfile(ctx);

    if (!profile) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'No profile found for the user. Complete onboarding to select an exam track.',
        );
    }

    // Tier gate immediately after auth/profile resolution. ALLOCATION_SUGGESTED is not in the
    // paid registry, so every tier is granted by default (Req 12.1, 12.4).
    const gate = assertTierAllowed(
        AnalyticsOutput.ALLOCATION_SUGGESTED,
        profile.subscriptionTier,
    );
    if (gate) {
        return gate;
    }

    // Active version = most recent referenceDataYear for the track (Req 3.6). When none exists
    // the dataset is unavailable for this track (Req 9.5).
    const referenceDataYear = await resolveActiveReferenceYear(
        profile.examTrack,
        ReferenceDatasetType.TOPIC_FREQUENCY,
    );

    if (referenceDataYear === null) {
        return errorResponse(
            503,
            ErrorCode.REFERENCE_DATA_UNAVAILABLE,
            'No topic-frequency reference data is available for your exam track.',
        );
    }

    // Read all pure-layer inputs (Chapters with override precedence applied, the user's PYQ
    // outcomes, the QuestionTopicMap links, and the active-year frequency records).
    const { chapters, outcomes, links, frequencyRecords } = await readAllocationData(
        ctx,
        profile.examTrack,
        referenceDataYear,
    );

    // Per-Chapter frequency signals (Req 1, 2).
    const pyqByChapter = pyqChapterFrequency(outcomes, links, chapters);
    const historicalByChapter = historicalChapterFrequency(chapters, frequencyRecords);

    // Combined_Weightage_Signal across the Chapters (Req 3).
    const signalInputs: ChapterSignalInput[] = chapters.map((chapter) => {
        const historical = historicalByChapter.get(chapter.id);
        return {
            chapterId: chapter.id,
            referenceKey: chapter.referenceKey,
            pyqFrequency: pyqByChapter.get(chapter.id) ?? 0,
            historicalFrequency: historical?.value ?? 0,
            hasHistoricalData: historical?.hasHistoricalData ?? false,
        };
    });

    const signals = combinedWeightageSignal(signalInputs);

    // Assemble the suggested-allocation inputs: each Chapter's signal augmented with its status,
    // effective weightage (override already applied by the reader), weightageIsDefault flag, and
    // any Time_Allocation_Override (Req 5, 6, 8).
    const chaptersById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const allocationInputs: SuggestedChapterInput[] = signals.map((signal) => {
        const chapter = chaptersById.get(signal.chapterId);
        return {
            ...signal,
            status: chapter?.status ?? 'NOT_STARTED',
            weightage: chapter?.weightage ?? null,
            weightageIsDefault: chapter?.weightageIsDefault ?? false,
            timeAllocationOverride: chapter?.timeAllocationOverride ?? null,
        };
    });

    const allocations = suggestedTimeAllocation(allocationInputs);

    // Single write: upsert the per-user snapshot (new model only) so timetable generation can
    // consume the most recently computed suggestion (Req 7.1). Scoped by userId (Req 10.2).
    await prisma.suggestedAllocationSnapshot.upsert({
        where: { userId: ctx.user.id },
        create: {
            userId: ctx.user.id,
            referenceDataYear,
            shares: allocations as unknown as Prisma.InputJsonValue,
            computedAt: new Date(),
        },
        update: {
            referenceDataYear,
            shares: allocations as unknown as Prisma.InputJsonValue,
            computedAt: new Date(),
        },
    });

    return Response.json({ referenceDataYear, allocations });
}
