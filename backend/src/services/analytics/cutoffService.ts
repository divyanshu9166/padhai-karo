/**
 * Target-cutoff selection & cutoff-listing service handlers (task 18.1; design
 * "Target Cutoff selection & Score-Gap endpoints", section 4).
 *
 * Implements the per-user cutoff-selection surface of Performance Analytics, each handler
 * scoped to the authenticated user (per-user isolation, Req 14.2). Route files stay
 * framework-thin and wrap these handlers with `withAuth` (task 26.3), so unauthenticated
 * requests are rejected with `401 UNAUTHORIZED` before any handler runs (Req 14.1).
 *
 *   GET /analytics/cutoffs        -> 200 { referenceDataYear, cutoffs: CutoffEntry[] }
 *                                    503 REFERENCE_DATA_UNAVAILABLE when no dataset exists
 *   GET /analytics/target-cutoff  -> 200 { selection | null }
 *   PUT /analytics/target-cutoff  -> 200 { selection }   ({ cutoffReferenceId } body)
 *                                    404 NOT_FOUND when the referenced cutoff is absent or
 *                                    does not belong to the user's active dataset
 *
 * Reference-data versioning follows the design's single rule: the *active* dataset for a
 * track is the most-recent `referenceDataYear`, resolved once via the shared
 * {@link resolveActiveReferenceYear} helper (Req 5.2). When no cutoff data exists for the
 * user's Exam_Track, cutoff listing returns `503 REFERENCE_DATA_UNAVAILABLE` (Req 5.4).
 *
 * The user's Exam_Track is read from their `Profile`. The selection is stored in the
 * additive `TargetCollegeCutoffSelection` model, which is unique by `userId` — a user has
 * at most one current selection — so `setTargetCutoff` upserts (Req 4.1).
 *
 * The score-gap handler (task 18.2) imports the `CutoffEntry` shape and the selection
 * model from here.
 */
import { ReferenceDatasetType } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { resolveActiveReferenceYear } from '@/lib/analytics/referenceVersion';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

/**
 * A selectable cutoff entry, drawn from the active `CutoffReferenceData` for the user's
 * track. `unit` interprets `closingValue`: `RANK` (lower is better), `PERCENTILE`/`MARKS`
 * (higher is better).
 */
export interface CutoffEntry {
    id: string;
    collegeName: string;
    branchName: string;
    category: string;
    closingValue: number;
    unit: 'RANK' | 'PERCENTILE' | 'MARKS';
}

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Read the authenticated user's Exam_Track from their `Profile`. Returns `null` when the
 * user has not completed onboarding (no profile row yet).
 */
async function getUserExamTrack(userId: string) {
    const profile = await prisma.profile.findUnique({
        where: { userId },
        select: { examTrack: true },
    });
    return profile?.examTrack ?? null;
}

/**
 * `GET /analytics/cutoffs` — list the selectable cutoff entries from the active dataset
 * for the user's Exam_Track (Req 4.1, 5.1, 5.2).
 *
 * Resolves the active (most recent) `referenceDataYear` for the track and returns every
 * `CutoffReferenceData` row for that `(track, year)`. When no cutoff data exists for the
 * user's track, responds `503 REFERENCE_DATA_UNAVAILABLE` (Req 5.4).
 */
export async function listCutoffs(_request: Request, auth: AuthContext): Promise<Response> {
    const examTrack = await getUserExamTrack(auth.user.id);
    if (!examTrack) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Profile not found.');
    }

    const referenceDataYear = await resolveActiveReferenceYear(
        examTrack,
        ReferenceDatasetType.CUTOFF,
    );
    if (referenceDataYear === null) {
        return errorResponse(
            503,
            ErrorCode.REFERENCE_DATA_UNAVAILABLE,
            'Cutoff reference data is unavailable for your exam track.',
        );
    }

    const rows = await prisma.cutoffReferenceData.findMany({
        where: { examTrack, referenceDataYear },
        orderBy: [{ collegeName: 'asc' }, { branchName: 'asc' }, { category: 'asc' }],
    });

    const cutoffs: CutoffEntry[] = rows.map((row) => ({
        id: row.id,
        collegeName: row.collegeName,
        branchName: row.branchName,
        category: row.category,
        closingValue: row.closingValue,
        unit: row.unit,
    }));

    return Response.json({ referenceDataYear, cutoffs }, { status: 200 });
}

/**
 * `GET /analytics/target-cutoff` — return the user's single Target_College_Cutoff
 * selection, or `null` when they have not selected one yet (Req 4.1, 14.2). Scoped to the
 * authenticated user via the `userId`-unique selection row.
 */
export async function getTargetCutoff(_request: Request, auth: AuthContext): Promise<Response> {
    const selection = await prisma.targetCollegeCutoffSelection.findUnique({
        where: { userId: auth.user.id },
    });
    return Response.json({ selection: selection ?? null }, { status: 200 });
}

/**
 * `PUT /analytics/target-cutoff` — persist (upsert) the user's single Target_College_Cutoff
 * selection (Req 4.1, 14.2).
 *
 * Validates that the supplied `cutoffReferenceId` references a real `CutoffReferenceData`
 * row that belongs to the active dataset for the user's Exam_Track — i.e. it matches the
 * user's track and the most-recent `referenceDataYear`. A missing, cross-track, or
 * stale-year reference yields `404 NOT_FOUND`. On success the user's single selection is
 * upserted (unique by `userId`) and returned.
 */
export async function setTargetCutoff(request: Request, auth: AuthContext): Promise<Response> {
    const examTrack = await getUserExamTrack(auth.user.id);
    if (!examTrack) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Profile not found.');
    }

    const body = await readJsonBody(request);
    const cutoffReferenceId =
        body && typeof body === 'object' && 'cutoffReferenceId' in body
            ? (body as { cutoffReferenceId: unknown }).cutoffReferenceId
            : undefined;

    if (typeof cutoffReferenceId !== 'string' || cutoffReferenceId.trim() === '') {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'A cutoffReferenceId is required.',
            { field: 'cutoffReferenceId' },
        );
    }

    const referenceDataYear = await resolveActiveReferenceYear(
        examTrack,
        ReferenceDatasetType.CUTOFF,
    );
    if (referenceDataYear === null) {
        return errorResponse(
            503,
            ErrorCode.REFERENCE_DATA_UNAVAILABLE,
            'Cutoff reference data is unavailable for your exam track.',
        );
    }

    // The referenced cutoff must exist AND belong to the active dataset for the user's
    // track (matching track + most-recent year). Anything else is treated as not found.
    const cutoff = await prisma.cutoffReferenceData.findUnique({
        where: { id: cutoffReferenceId },
    });
    if (!cutoff || cutoff.examTrack !== examTrack || cutoff.referenceDataYear !== referenceDataYear) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'The selected cutoff is not part of the active dataset for your exam track.',
        );
    }

    const selection = await prisma.targetCollegeCutoffSelection.upsert({
        where: { userId: auth.user.id },
        create: { userId: auth.user.id, cutoffReferenceId },
        update: { cutoffReferenceId },
    });

    return Response.json({ selection }, { status: 200 });
}
