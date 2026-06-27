/**
 * Onboarding / Profile Service (task 4.1, design "Onboarding / Profile Service").
 *
 * Implements `POST /api/onboarding`: it validates the payload, persists the user's exam
 * track, target year, current class, fixed commitments, and peak focus windows to their
 * `Profile` (Req 2.1, 2.8), derives `targetExamDate` from the reference catalog where
 * available, marks onboarding complete, and instantiates the per-user `Chapter` set for
 * the selected track initialized to `NOT_STARTED` (Req 2.4, 2.7).
 *
 * Resilience (Req 2.5): the profile/track is persisted FIRST, in its own transaction.
 * Chapter instantiation runs afterward in a SEPARATE transaction wrapped in try/catch. If
 * chapter association fails, the already-committed profile (and therefore the exam-track
 * selection) is preserved and the request still succeeds, so the user can continue
 * onboarding — the timetable engine simply has no chapters to schedule until association
 * is retried.
 *
 * All writes are scoped to the authenticated `ctx.user.id` (per-user isolation). The
 * handler is framework-thin: the route file wraps it with `withAuth`.
 */
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { getExamDate } from '@/lib/reference';

import { toChapterCreateInputs, validateOnboardingInput } from './validation';
import type { OnboardingInput } from './validation';

/** Parse the JSON request body, returning `null` when the body is not valid JSON. */
async function parseJsonBody(request: Request): Promise<unknown | null> {
    try {
        return (await request.json()) as unknown;
    } catch {
        return null;
    }
}

/**
 * Persist the user's profile (exam track, target year, class, peak focus windows, target
 * exam date) and mark onboarding complete. Upsert keyed by `userId` so re-running
 * onboarding updates the existing profile rather than failing on the unique constraint.
 * Defaults (language, tier, quota, revision buffer, buffer policy) are left untouched on
 * update.
 */
async function persistProfile(userId: string, input: OnboardingInput) {
    const targetExamDate = getExamDate(input.examTrack, input.targetYear) ?? null;

    const profileData = {
        examTrack: input.examTrack,
        targetYear: input.targetYear,
        currentClass: input.currentClass,
        peakFocusWindows: input.peakFocusWindows,
        targetExamDate,
        onboardingComplete: true,
    };

    return prisma.profile.upsert({
        where: { userId },
        create: { userId, ...profileData },
        update: profileData,
    });
}

/**
 * Replace the user's fixed commitments with the supplied set, inside a transaction so the
 * swap is atomic. Persisting the validated commitments here keeps the profile write
 * (above) focused on the `Profile` row while still completing Req 2.1.
 */
async function persistFixedCommitments(userId: string, input: OnboardingInput): Promise<void> {
    await prisma.$transaction([
        prisma.fixedCommitment.deleteMany({ where: { userId } }),
        prisma.fixedCommitment.createMany({
            data: input.fixedCommitments.map((commitment) => ({
                userId,
                dayOfWeek: commitment.dayOfWeek,
                startTime: commitment.startTime,
                endTime: commitment.endTime,
                label: commitment.label,
            })),
        }),
    ]);
}

/**
 * Instantiate the per-user chapter set for the selected track (Req 2.4, 2.7). Existing
 * chapters for the user are cleared first so re-running onboarding (including a track
 * switch) yields exactly the new track's chapters. Runs in a transaction for atomicity.
 *
 * This is the step Req 2.5 protects: callers invoke it after the profile commit and treat
 * a thrown error as a recoverable "association failed" rather than a fatal onboarding
 * failure.
 */
async function associateChapters(userId: string, input: OnboardingInput): Promise<void> {
    const chapters = toChapterCreateInputs(input.examTrack, userId);
    await prisma.$transaction([
        prisma.chapter.deleteMany({ where: { userId } }),
        prisma.chapter.createMany({ data: chapters }),
    ]);
}

/**
 * Handle `POST /api/onboarding`.
 *
 * Order of operations honors Req 2.5: validate → persist profile + commitments (committed
 * independently) → attempt chapter association (best-effort). On a chapter-association
 * failure the response still returns `200 { profile }` with `chaptersAssociated: false`,
 * preserving the exam-track selection.
 *
 * @param request - the incoming request (JSON body).
 * @param ctx - the authenticated context; all writes are scoped to `ctx.user.id`.
 */
export async function onboardingHandler(request: Request, ctx: AuthContext): Promise<Response> {
    const raw = await parseJsonBody(request);
    if (raw === null) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be valid JSON.');
    }

    const currentYear = new Date().getUTCFullYear();
    const validation = validateOnboardingInput(raw, currentYear);
    if (!validation.ok) {
        return errorResponse(422, validation.code, validation.message, validation.details);
    }

    const input = validation.value;
    const userId = ctx.user.id;

    // Persist the core profile + track and fixed commitments first so the exam-track
    // selection is durable before the (best-effort) chapter association (Req 2.5).
    const profile = await persistProfile(userId, input);
    await persistFixedCommitments(userId, input);

    // Req 2.5: a failure here must not lose the track selection or block onboarding.
    let chaptersAssociated = true;
    try {
        await associateChapters(userId, input);
    } catch {
        chaptersAssociated = false;
    }

    return Response.json({ profile, chaptersAssociated }, { status: 200 });
}
