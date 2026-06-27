/**
 * Most_Frequent_Chapters service handler (task 10.2; design "Service layer → allocation
 * endpoints"; Req 4.1, 4.2, 4.6, 10.1).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/allocation/most-frequent-chapters
 *     -> 200 { referenceDataYear, chapters: ChapterSignal[] }
 *     -> 404 NOT_FOUND                   (no profile / not onboarded)
 *     -> 503 REFERENCE_DATA_UNAVAILABLE  (no topic-frequency dataset for the track)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 / Performance Analytics layering
 * convention (see `src/services/analytics/topicPriorityService.ts`): after `withAuth` (applied
 * by the route file, Req 10.1) it reads the user's `Profile` slice, resolves the active
 * topic-frequency dataset version, applies the tier gate, reads the pure-layer inputs through
 * the shared {@link readAllocationData} reader, then delegates ALL computation to the pure
 * `src/lib/allocation/*` modules — assembling the per-Chapter {@link ChapterSignalInput}s,
 * computing the {@link combinedWeightageSignal}, and ordering them via
 * {@link mostFrequentChapters} (Req 4.1, 4.6). The active reference year is echoed in the 200
 * payload (Req 4.2).
 *
 * Signal assembly (the `pyqChapterFrequency` + `historicalChapterFrequency` →
 * `ChapterSignalInput[]` pipeline) is shared between the signal endpoint (task 10.1) and this
 * one. It is factored into the exported {@link assembleChapterSignals} helper so both handlers
 * compute the same Combined_Weightage_Signal from the same reader inputs without duplicating
 * the wiring; this handler then layers the Most_Frequent_Chapters ordering on top.
 *
 * Per-user isolation (Req 10.2) and read-only sourcing (Req 9.4) are enforced by the reader:
 * every user-owned query is scoped by `ctx.user.id`, and no existing row is mutated.
 *
 * Tier gating (Req 12): the gate consults `ALLOCATION_MOST_FREQUENT_CHAPTERS`, which is
 * deliberately left out of the Paid set, so the output defaults to Free for every tier while
 * remaining one edit away from a Paid designation.
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
    type ChapterSignal,
    type ChapterSignalInput,
} from '@/lib/allocation/signal';
import { mostFrequentChapters } from '@/lib/allocation/ranking';

import {
    readAllocationData,
    readAllocationProfile,
    type AllocationData,
} from './allocationReader';
import { assertTierAllowed, AnalyticsOutput } from '@/services/analytics/tierGate';

/**
 * Assemble the per-Chapter {@link ChapterSignal}s from already-read allocation inputs.
 *
 * Builds each Chapter's {@link ChapterSignalInput} by joining its `PYQ_Chapter_Frequency`
 * (`pyqChapterFrequency`) with its `Historical_Chapter_Frequency`
 * (`historicalChapterFrequency`), then fuses and normalizes them via
 * {@link combinedWeightageSignal} (Req 3). This is the shared pipeline behind both the signal
 * and most-frequent endpoints; ordering is applied by the caller. Pure with respect to the
 * inputs — it reads `data` only and returns a fresh array.
 *
 * @param data The reader-produced pure-layer inputs for one computation.
 * @returns The per-Chapter combined signals, in the reader's Chapter order.
 */
export function assembleChapterSignals(data: AllocationData): ChapterSignal[] {
    const pyqByChapter = pyqChapterFrequency(data.outcomes, data.links, data.chapters);
    const historicalByChapter = historicalChapterFrequency(
        data.chapters,
        data.frequencyRecords,
    );

    const inputs: ChapterSignalInput[] = data.chapters.map((chapter) => {
        const historical = historicalByChapter.get(chapter.id);
        return {
            chapterId: chapter.id,
            referenceKey: chapter.referenceKey,
            pyqFrequency: pyqByChapter.get(chapter.id) ?? 0,
            historicalFrequency: historical?.value ?? 0,
            hasHistoricalData: historical?.hasHistoricalData ?? false,
        };
    });

    return combinedWeightageSignal(inputs);
}

/**
 * Handle `GET /api/allocation/most-frequent-chapters`.
 *
 * Reads the user's Exam_Track via their Profile; a user without a profile has not completed
 * onboarding, so the endpoint returns `404 NOT_FOUND` rather than guessing a track
 * (consistent with the analytics handlers). Resolves the active topic-frequency version,
 * returning `503 REFERENCE_DATA_UNAVAILABLE` when no dataset exists for the track (Req 4.2),
 * gates the output by Subscription_Tier (Req 12.1), reads the pure-layer inputs, computes the
 * combined signals, and returns them ordered as the Most_Frequent_Chapters list (Req 4.1, 4.6).
 */
export async function mostFrequentChaptersHandler(
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

    // Active version = most recent referenceDataYear for the track. When none exists the
    // topic-frequency dataset is unavailable for this track.
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

    // Tier gate (Req 12.1): defaults open for every tier while the output is not Paid.
    const gate = assertTierAllowed(
        AnalyticsOutput.ALLOCATION_MOST_FREQUENT_CHAPTERS,
        profile.subscriptionTier,
    );
    if (gate) {
        return gate;
    }

    const data = await readAllocationData(ctx, profile.examTrack, referenceDataYear);

    // Compute the combined signals, then apply the Most_Frequent_Chapters ordering (Req 4.1).
    const signals = assembleChapterSignals(data);
    const chapters = mostFrequentChapters(signals);

    return Response.json({ referenceDataYear, chapters });
}
