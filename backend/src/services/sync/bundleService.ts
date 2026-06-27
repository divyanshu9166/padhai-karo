/**
 * Offline paper-bundle download (task 18.1; design "Offline Sync Handler",
 * "Offline-Sync Approach"; Req 21.1).
 *
 *   GET /api/offline/papers/:id/bundle
 *     -> 200 { paper, answerKey }
 *     -> 404 NOT_FOUND (paper missing)
 *
 * Returns a downloadable `PYQ_Paper` + `Answer_Key` bundle so the client can store it on the
 * device as an `Offline_Download` and serve/score it while offline (Req 21.1).
 *
 * DOCUMENTED DESIGN DIFFERENCE — this endpoint INCLUDES the answer key (both the paper's
 * questions' `correctOption` and the `Answer_Key` row's `entries`). That is intentional and
 * follows the design's "Offline-Sync Approach", which downloads the paper *together with its
 * answer key* to the device because, while offline, there is no server to score against —
 * the client must score locally. This is a deliberate difference from the ONLINE practice
 * listing (`GET /pyqs`, `GET /papers/:id`), which hides `correctOption` so the key cannot be
 * read before submitting and scoring stays server-side. Offline mode trades that protection
 * for offline capability, exactly as the design specifies. (Captured offline activity is
 * later re-scored authoritatively server-side on `POST /sync`, so the canonical score never
 * depends on the client.)
 *
 * The endpoint is guarded by `withAuth` (a valid session is required) but paper content is
 * global, so no per-user ownership scoping applies.
 */
import { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

/** Framework route context for the dynamic `:id` segment. */
export interface PaperBundleRouteContext {
    params: { id: string };
}

/**
 * Prisma `select` for the bundle. Unlike the online listing, the offline bundle INCLUDES
 * each question's `correctOption` and the `Answer_Key` row so the device can score locally
 * while offline (see module docstring). Kept explicit so the shape is auditable.
 */
const PAPER_BUNDLE_SELECT = {
    id: true,
    examTrack: true,
    year: true,
    session: true,
    durationMin: true,
    questions: {
        select: {
            id: true,
            examTrack: true,
            year: true,
            subjectId: true,
            questionText: true,
            options: true,
            correctOption: true,
            flaggedForReview: true,
        },
        orderBy: { id: 'asc' },
    },
    answerKey: {
        select: { id: true, paperId: true, entries: true },
    },
} as const satisfies Prisma.PYQPaperSelect;

/**
 * Handle `GET /api/offline/papers/:id/bundle`. Loads the paper with its questions and its
 * answer key and returns them as a download bundle. The route file wraps this with
 * `withAuth` so unauthenticated requests are rejected upstream.
 */
export async function getPaperBundleHandler(
    _request: Request,
    _auth: AuthContext,
    routeContext: PaperBundleRouteContext,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A paper id is required.', {
            field: 'id',
        });
    }

    const paper = await prisma.pYQPaper.findUnique({
        where: { id },
        select: PAPER_BUNDLE_SELECT,
    });

    if (!paper) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Paper not found.');
    }

    // Split the answer-key relation out into a top-level `answerKey` to match the design's
    // `{ paper, answerKey }` response shape; `paper` still carries its questions.
    const { answerKey, ...paperWithoutKey } = paper;
    return Response.json({ paper: paperWithoutKey, answerKey });
}
