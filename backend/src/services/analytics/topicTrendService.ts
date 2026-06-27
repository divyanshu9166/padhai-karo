/**
 * Topic Trend Service handler (task 19.1; design "Topic Trend endpoint"; Req 7.1, 6.3,
 * 5.4, 14.2).
 *
 * Implements the single read endpoint:
 *
 *   GET /api/analytics/topic-trends
 *     -> 200 { referenceDataYear, topics: TopicTrend[] }
 *     -> 503 REFERENCE_DATA_UNAVAILABLE  (no topic-frequency dataset for the track)
 *
 * The handler is intentionally THIN, mirroring the Phase 1 layering convention (see
 * `dashboardService.ts`, `pyqService.ts`): it reads the authenticated user's Exam_Track
 * from their `Profile`, builds the Topic universe for that track from the seeded reference
 * chapter catalog (`lib/reference`), resolves the active topic-frequency dataset version
 * via the shared resolver, loads that version's rows, then delegates ALL projection,
 * zero-fill, and ordering math to the pure `projectTopicTrends` module.
 *
 * Per-user isolation (Req 14.2): the only per-user input is the user's Exam_Track, read via
 * `prisma.profile.findUnique({ where: { userId: ctx.user.id } })`; the route wraps this with
 * `withAuth` so unauthenticated requests are rejected upstream (Req 14.1). The reference
 * data itself is system-supplied and identical for all users of a track.
 *
 * Reference-data versioning (Req 6.3, 5.4): the active version is the maximum
 * `referenceDataYear` present for the track, resolved by
 * `resolveActiveReferenceYear(track, TOPIC_FREQUENCY)`. When no topic-frequency rows exist
 * for the track the resolver returns `null` and this handler returns
 * `503 REFERENCE_DATA_UNAVAILABLE` (Req 5.4).
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

/**
 * Handle `GET /api/analytics/topic-trends`.
 *
 * Resolves the user's Exam_Track from their Profile; a user without a profile/track has not
 * completed onboarding, so the endpoint returns `404 NOT_FOUND` directing them to onboard
 * rather than guessing a track (consistent with `pyqService`).
 */
export async function topicTrendsHandler(
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

    // The Topic universe is the track's chapter catalog: Topic == Chapter.referenceKey, with
    // the chapter's display name as the Topic name and its owning subject's display name.
    const topicUniverse: TopicUniverseEntry[] = getChapters(examTrack).map((chapter) => ({
        topicKey: chapter.referenceKey,
        topicName: chapter.name,
        subjectName: chapter.subjectName,
    }));

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

    const topics = projectTopicTrends(topicUniverse, activeRecords);

    return Response.json({ referenceDataYear, topics });
}
