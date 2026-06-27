/**
 * NTA Update Feed read service (task 17.2, design "NTA Update Feed (Worker + read API)").
 *
 * Serves the read endpoint described in the design table:
 *
 *   GET /api/nta/feed   -> 200 { announcements[] }   (track-filtered, chronological, Req 20.5)
 *
 * Behaviour (Req 20.5):
 *   - Returns ONLY announcements whose `examScope` maps to the authenticated user's
 *     Exam_Track (read from their Profile). The scope→track mapping reuses the worker's
 *     {@link examScopeToTrack} so a JEE user sees both `JEE_MAIN` and `JEE_ADVANCED`
 *     items and a NEET user sees `NEET` items — there is a single source of truth for
 *     which scopes belong to which track.
 *   - `NTAAnnouncement` rows are global (not user-owned); the feed is filtered to track
 *     at read time, so no ownership assertion is needed — only the session guard
 *     (`withAuth`) wrapping the route.
 *
 * Chronological ordering (documented decision, task 17.2):
 *   The feed is ordered **most-recent-first** — `orderBy: { publishedAt: 'desc' }`. A
 *   user opening the feed wants the latest exam-date change / admit-card / answer-key
 *   release at the top, matching the in-app "update feed" mental model. `id` is used as
 *   a deterministic tiebreaker so announcements sharing a `publishedAt` have a stable
 *   order across requests.
 *
 * No-profile decision (documented decision, task 17.2):
 *   A user without a Profile has not completed onboarding and therefore has no
 *   Exam_Track to filter by. Rather than guessing a track or returning an unfiltered
 *   feed, the endpoint returns `404 NOT_FOUND` directing them to onboard — consistent
 *   with the sibling PYQ listing endpoint (task 11.2).
 *
 * Client projection (documented decision, task 17.2):
 *   The feed returns only display-relevant columns ({@link NTA_FEED_SELECT}). The
 *   internal `dedupeHash` (a de-duplication fingerprint) is never exposed to clients.
 *
 * The track→scopes mapping and the where-clause builder are kept as small pure functions
 * so they are unit-testable without a live database; the {@link ntaFeedHandler} wires
 * them to Prisma and the authenticated user.
 */
import type { ExamTrack, Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import prisma from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors/errorEnvelope';
import { EXAM_SCOPES, examScopeToTrack } from '@/workers/ntaIngestion/types';
import type { ExamScope } from '@/workers/ntaIngestion/types';

/**
 * The shape returned to the client for a single announcement in the feed. Mirrors the
 * stored `NTAAnnouncement` minus internal bookkeeping (`dedupeHash`, `createdAt`,
 * `updatedAt`): see the module docstring "Client projection".
 */
export interface ClientNTAAnnouncement {
    id: string;
    examScope: string;
    title: string;
    body: string;
    publishedAt: Date;
    affectsExamDate: boolean;
    newExamDate: Date | null;
}

/**
 * Prisma `select` for the feed listing. Restricts the fetched columns to exactly the
 * safe client projection so the internal `dedupeHash` is never read out of the database
 * for this endpoint. Kept in sync with {@link ClientNTAAnnouncement}.
 */
export const NTA_FEED_SELECT = {
    id: true,
    examScope: true,
    title: true,
    body: true,
    publishedAt: true,
    affectsExamDate: true,
    newExamDate: true,
} as const satisfies Prisma.NTAAnnouncementSelect;

/**
 * The set of {@link ExamScope}s whose announcements belong to a given Exam_Track. This is
 * the inverse of {@link examScopeToTrack}, computed by filtering the canonical scope list
 * so there is a single source of truth for the scope↔track relationship: `JEE` resolves
 * to `['JEE_MAIN', 'JEE_ADVANCED']` and `NEET` to `['NEET']` (Req 20.5).
 *
 * Pure and dependency-free — exercised directly by unit tests.
 */
export function trackToExamScopes(track: ExamTrack): ExamScope[] {
    return EXAM_SCOPES.filter((scope) => examScopeToTrack(scope) === track);
}

/**
 * Build the Prisma `where` clause for the feed: announcements whose `examScope` is in the
 * set of scopes for the user's track (Req 20.5). Uses an `in` filter over the scopes from
 * {@link trackToExamScopes}.
 */
export function buildNtaFeedWhere(track: ExamTrack): Prisma.NTAAnnouncementWhereInput {
    return { examScope: { in: trackToExamScopes(track) } };
}

/**
 * The `orderBy` for the feed: most-recent-first by `publishedAt`, with `id` as a stable
 * deterministic tiebreaker (see module docstring "Chronological ordering").
 */
export const NTA_FEED_ORDER_BY = [
    { publishedAt: 'desc' },
    { id: 'asc' },
] as const satisfies Prisma.NTAAnnouncementOrderByWithRelationInput[];

/**
 * Defensively re-project an announcement row to the client shape, dropping any field
 * other than the safe display columns. Even though {@link NTA_FEED_SELECT} already limits
 * the fetched columns, this guards against an accidentally over-broad query leaking
 * internal fields such as `dedupeHash`.
 */
export function toClientAnnouncement(row: ClientNTAAnnouncement): ClientNTAAnnouncement {
    return {
        id: row.id,
        examScope: row.examScope,
        title: row.title,
        body: row.body,
        publishedAt: row.publishedAt,
        affectsExamDate: row.affectsExamDate,
        newExamDate: row.newExamDate,
    };
}

/**
 * GET /api/nta/feed
 *
 * Returns the stored NTA announcements filtered to the authenticated user's Exam_Track in
 * most-recent-first chronological order (Req 20.5). Resolves the track from the user's
 * Profile; a user without a profile has not onboarded, so the endpoint returns
 * `404 NOT_FOUND` directing them to onboard rather than guessing a track.
 */
export async function ntaFeedHandler(_request: Request, ctx: AuthContext): Promise<Response> {
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

    const rows = await prisma.nTAAnnouncement.findMany({
        where: buildNtaFeedWhere(profile.examTrack),
        select: NTA_FEED_SELECT,
        orderBy: NTA_FEED_ORDER_BY as Prisma.NTAAnnouncementOrderByWithRelationInput[],
    });

    return Response.json({ announcements: rows.map(toClientAnnouncement) });
}
