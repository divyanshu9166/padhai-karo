/**
 * Topic Prioritization service handler (task 20.1; design "Topic Prioritization endpoint
 * (Req 8, 12)"; Req 8.1, 12.2, 6.3, 5.4, 14.2).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/analytics/topic-priority
 *     -> 200 { referenceDataYear, topics: TopicPriority[] }
 *     -> 503 REFERENCE_DATA_UNAVAILABLE  (no topic-frequency dataset for the track)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 / Phase 2 layering convention
 * (see `topicTrendService.ts`, `rankPredictionService.ts`, `dashboardService.ts`): it reads
 * the authenticated user's Exam_Track, resolves the active topic-frequency dataset version,
 * builds the Topic-frequency input, obtains the user's per-Topic `weakAreaScore` map, then
 * delegates ALL combination, flagging, and ordering math to the pure {@link prioritizeTopics}.
 *
 * Two signals are fused (design "Topic prioritization", Req 8.1):
 *   1. The DATASET signal — each Topic's `avgQuestionsPerYear` from the active
 *      `TopicFrequencyReferenceData` for the track. The frequency input is built exactly as
 *      the Topic Trend endpoint builds its dataset: the Topic universe is the track's chapter
 *      catalog (`lib/reference`), left-joined against the active topic-frequency records and
 *      zero-filled for topics the dataset does not mention, via the shared, pure
 *      {@link projectTopicTrends}. The resulting `TopicTrend[]` is a structural superset of
 *      `prioritizeTopics`'s `TopicFrequencyInput`, so it is passed through directly.
 *   2. The USER signal — the per-Topic `weakAreaScore` map obtained from the weak-area
 *      service via {@link getWeakAreaResult}, reusing the same computation that powers the
 *      weak-area endpoint rather than recomputing it (Req 12.2).
 *
 * Per-user isolation (Req 14.2): the only per-user inputs are the user's Exam_Track (read by
 * `userId`) and the weak-area result (computed from rows scoped by `userId`). The
 * topic-frequency reference data is system-supplied and identical for all users of a track.
 * The route file wraps this handler with `withAuth`, rejecting unauthenticated requests with
 * `401 UNAUTHORIZED` before it runs (Req 14.1).
 *
 * Reference-data versioning (Req 6.3, 5.4): the active version is the maximum
 * `referenceDataYear` present for the track, resolved by
 * `resolveActiveReferenceYear(track, TOPIC_FREQUENCY)`. When no topic-frequency rows exist
 * for the track the resolver returns `null` and this handler returns
 * `503 REFERENCE_DATA_UNAVAILABLE` (Req 5.4); the active year is echoed in the 200 payload
 * (Req 6.3).
 */
import { ReferenceDatasetType } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { resolveActiveReferenceYear } from '@/lib/analytics/referenceVersion';
import { getChapters } from '@/lib/reference';

import {
    projectTopicTrends,
    type ActiveTopicFrequencyRecord,
    type TopicUniverseEntry,
} from './topicTrend';
import { prioritizeTopics } from './topicPriority';
import { getWeakAreaResult } from './weakAreaService';

/**
 * Handle `GET /api/analytics/topic-priority`.
 *
 * Resolves the user's Exam_Track from their Profile; a user without a profile/track has not
 * completed onboarding, so the endpoint returns `404 NOT_FOUND` directing them to onboard
 * rather than guessing a track (consistent with `topicTrendService`).
 */
export async function topicPriorityHandler(
    _request: Request,
    ctx: AuthContext,
): Promise<Response> {
    const profile = await prisma.profile.findUnique({
        where: { userId: ctx.user.id },
        select: { examTrack: true },
    });

    if (!profile) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'No profile found for the user. Complete onboarding to select an exam track.',
        );
    }

    const { examTrack } = profile;

    // Active version = most recent referenceDataYear for the track (Req 6.3). When none
    // exists the dataset is unavailable for this track (Req 5.4).
    const referenceDataYear = await resolveActiveReferenceYear(
        examTrack,
        ReferenceDatasetType.TOPIC_FREQUENCY,
    );

    if (referenceDataYear === null) {
        return errorResponse(
            503,
            ErrorCode.REFERENCE_DATA_UNAVAILABLE,
            'No topic-frequency reference data is available for your exam track.',
        );
    }

    // Build the Topic-frequency input exactly as the Topic Trend endpoint does: the Topic
    // universe is the track's chapter catalog (Topic == Chapter.referenceKey), left-joined
    // against the active topic-frequency records and zero-filled by projectTopicTrends. The
    // resulting TopicTrend[] is a structural superset of prioritizeTopics's
    // TopicFrequencyInput (it carries topicKey, topicName, avgQuestionsPerYear).
    const topicUniverse: TopicUniverseEntry[] = getChapters(examTrack).map((chapter) => ({
        topicKey: chapter.referenceKey,
        topicName: chapter.name,
        subjectName: chapter.subjectName,
    }));

    const records = await prisma.topicFrequencyReferenceData.findMany({
        where: { examTrack, referenceDataYear },
        select: {
            topicKey: true,
            appearanceCount: true,
            yearSpanStart: true,
            yearSpanEnd: true,
            avgQuestionsPerYear: true,
        },
    });

    const activeRecords: ActiveTopicFrequencyRecord[] = records.map((record) => ({
        topicKey: record.topicKey,
        appearanceCount: record.appearanceCount,
        yearSpanStart: record.yearSpanStart,
        yearSpanEnd: record.yearSpanEnd,
        avgQuestionsPerYear: record.avgQuestionsPerYear,
    }));

    const frequencies = projectTopicTrends(topicUniverse, activeRecords);

    // User signal: the per-Topic weakAreaScore map from the weak-area service, computed from
    // rows scoped by the requesting user's id (Req 12.2, 14.2).
    const { weakAreaScoreByTopic } = await getWeakAreaResult(ctx.user.id);

    // Delegate all combination, flagging, and ordering to the pure module (Req 8.1, 8.2, 8.3, 8.4).
    const topics = prioritizeTopics(frequencies, weakAreaScoreByTopic);

    return Response.json({ referenceDataYear, topics });
}
