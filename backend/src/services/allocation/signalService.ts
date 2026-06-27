/**
 * Combined_Weightage_Signal service handler (task 10.1; design "Service layer →
 * `signalService.ts`" and "API endpoints"; Req 3.6, 3.7, 9.5, 10.1, 12.1).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/allocation/signal
 *     -> 200 { referenceDataYear, chapters: ChapterSignal[] }
 *     -> 401 UNAUTHORIZED                (no/invalid session — enforced by `withAuth`)
 *     -> 404 NOT_FOUND                   (user has no Profile — not onboarded)
 *     -> 503 REFERENCE_DATA_UNAVAILABLE  (no topic-frequency dataset for the track)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 / Performance Analytics layering
 * convention (see `src/services/analytics/topicPriorityService.ts`): it reads the requesting
 * user's Profile (for version selection and tier gating), resolves the active topic-frequency
 * dataset version, applies the monetization tier gate, reads the pure-layer inputs through the
 * shared `allocationReader`, assembles the per-Chapter {@link ChapterSignalInput}s from the two
 * pure frequency derivations, then delegates ALL combination/normalization math to the pure
 * {@link combinedWeightageSignal}.
 *
 * Reference-data versioning (Req 3.7, 9.5): the active version is the maximum
 * `referenceDataYear` present for the track, resolved by
 * `resolveActiveReferenceYear(track, TOPIC_FREQUENCY)`. When no topic-frequency rows exist for
 * the track the resolver returns `null` and this handler returns `503
 * REFERENCE_DATA_UNAVAILABLE`; otherwise the active year is echoed in the 200 payload (Req 3.6).
 *
 * Tier gating (Req 12.1): the `ALLOCATION_SIGNAL` output is gated through the shared
 * `assertTierAllowed` seam immediately after the Profile read. The output is not currently
 * Paid-designated, so every tier is granted, but the gate is wired so a future Paid designation
 * is a one-line registry edit.
 *
 * Per-user isolation (Req 10.1): every per-user input is read through the `allocationReader`
 * scoped by `ctx.user.id`; the topic-frequency reference data and `QuestionTopicMap` are
 * system-supplied and identical for all users of a track. The route file wraps this handler with
 * `withAuth`, rejecting unauthenticated requests with `401 UNAUTHORIZED` before it runs.
 */
import { ReferenceDatasetType } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
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
import { AnalyticsOutput, assertTierAllowed } from '@/services/analytics/tierGate';

import { readAllocationData, readAllocationProfile } from './allocationReader';

/**
 * Handle `GET /api/allocation/signal`.
 *
 * Resolves the user's Profile (a user without one has not completed onboarding, so the endpoint
 * returns `404 NOT_FOUND` consistent with the reader), gates the output by Subscription_Tier,
 * resolves the active topic-frequency reference year (`503` when none exists), reads the
 * pure-layer inputs, derives each Chapter's PYQ and historical frequency, and returns the
 * normalized Combined_Weightage_Signal per Chapter (Req 3.6).
 */
export async function signalHandler(
    _request: Request,
    ctx: AuthContext,
): Promise<Response> {
    const profile = await readAllocationProfile(ctx);

    if (!profile) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'No profile found for the user. Complete onboarding to select an exam track.',
        );
    }

    // Monetization gating seam (Req 12.1). Free for every tier by default; one registry edit
    // away from a Paid designation.
    const gate = assertTierAllowed(
        AnalyticsOutput.ALLOCATION_SIGNAL,
        profile.subscriptionTier,
    );
    if (gate) {
        return gate;
    }

    // Active version = most recent referenceDataYear for the track (Req 3.7). When none exists
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

    const { chapters, outcomes, links, frequencyRecords } = await readAllocationData(
        ctx,
        profile.examTrack,
        referenceDataYear,
    );

    // Derive the two per-Chapter frequency signals from the pure layer (Req 1, 2).
    const pyqByChapter = pyqChapterFrequency(outcomes, links, chapters);
    const historicalByChapter = historicalChapterFrequency(chapters, frequencyRecords);

    // Assemble the pure combined-signal inputs, preserving Chapter order.
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

    // Delegate combination + min-max normalization to the pure module (Req 3.1–3.5).
    const chapterSignals = combinedWeightageSignal(signalInputs);

    return Response.json({ referenceDataYear, chapters: chapterSignals });
}
