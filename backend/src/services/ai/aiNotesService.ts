/**
 * AI Notes Service handlers (task 16.1; design "AI Notes Service (Req 8, 9)" and
 * "AI Notes Request Flow & Usage Accounting").
 *
 * Implements:
 *
 *   POST /api/ai/summaries
 *     body: { inputType: "TEXT" | "PHOTO", text?, imageUploadId? }
 *     -> 201 { summary, remainingQuota }                                   (Req 8.1/8.2/8.6)
 *     -> 402 UPGRADE_REQUIRED   (free tier, no usage recorded)             (Req 9.1)
 *     -> 429 QUOTA_EXCEEDED     (paid, quota 0, no usage recorded)         (Req 9.2)
 *     -> 422 EMPTY_INPUT/VALIDATION_ERROR (paid+quota, records ONE usage,
 *             no quota decrement)                                          (Req 8.3/8.5/9.3)
 *     -> 503 AI_PROVIDER_UNAVAILABLE (failure after gates: no usage, no
 *             quota decrement — the user is not charged for infra failure)
 *
 *   GET /api/ai/summaries
 *     -> 200 { summaries[] }   (the authenticated user's summaries)
 *
 * THE ORDER OF OPERATIONS MATTERS (design): tier gate → quota gate → input validation →
 * produce. Usage is recorded on validation rejection AND on production, but NOT on the
 * tier/quota gates; quota decrements ONLY on production. The acceptance path (persist
 * summary + record usage + decrement quota) runs inside a single transaction so the
 * "exactly one usage" and "decrement by exactly one" semantics are atomic and never
 * double-counted.
 *
 * The AI provider is injected as an {@link AiSummarizer} (defaulting to the concrete
 * {@link ProviderAiSummarizer}) so tests pass a mock and no live API call runs.
 */
import { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { ProviderAiSummarizer } from './aiSummarizer';
import { validateSummaryInput } from './inputValidation';
import type { AiSummarizer } from './types';

/** Default provider instance; lazily reads the API key only when actually invoked. */
const defaultSummarizer: AiSummarizer = new ProviderAiSummarizer();

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Handle `POST /api/ai/summaries`. The route wraps this with `withAuth`, so an
 * unauthenticated request is rejected with 401 before this runs. Every read/write is
 * scoped to `auth.user.id` for per-user isolation.
 *
 * @param summarizer - injected AI provider seam; defaults to {@link ProviderAiSummarizer}.
 *   Tests pass a mock so no live call is made.
 */
export async function createSummaryHandler(
    request: Request,
    auth: AuthContext,
    summarizer: AiSummarizer = defaultSummarizer,
): Promise<Response> {
    const userId = auth.user.id;

    // Resolve the user's tier + remaining quota. Without a profile we cannot determine the
    // tier, so direct the user to onboarding rather than guessing (consistent with PYQ).
    const profile = await prisma.profile.findUnique({
        where: { userId },
        select: { subscriptionTier: true, aiQuota: true },
    });

    if (!profile) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'No profile found for the user. Complete onboarding before using AI notes.',
        );
    }

    // (1) Tier gate — free users never reach validation or quota; record NO usage (Req 9.1).
    if (profile.subscriptionTier === 'FREE') {
        return errorResponse(
            402,
            ErrorCode.UPGRADE_REQUIRED,
            'AI notes summarization requires a paid subscription.',
        );
    }

    // (2) Quota gate — paid user with zero remaining quota; record NO usage (Req 9.2).
    if (profile.aiQuota <= 0) {
        return errorResponse(
            429,
            ErrorCode.QUOTA_EXCEEDED,
            'Your AI usage quota has been exhausted.',
        );
    }

    // (3) Input validation (paid + quota > 0). On rejection record EXACTLY ONE usage unit
    //     (Req 8.5) and DO NOT decrement quota (Req 9.3).
    const body = await readJsonBody(request);
    const validation = validateSummaryInput(body);
    if (!validation.ok) {
        await prisma.aiUsageEvent.create({
            data: { userId, outcome: 'VALIDATION_REJECTED', summaryId: null },
        });
        return errorResponse(422, validation.code, validation.message, validation.details);
    }

    // (4) Produce summary. Call the model BEFORE recording usage so a provider/transport
    //     failure (neither produced nor validation-rejected) records NO usage and does NOT
    //     decrement quota (design "AI Provider Failures").
    let result;
    try {
        result = await summarizer.summarize(validation.value);
    } catch {
        return errorResponse(
            503,
            ErrorCode.AI_PROVIDER_UNAVAILABLE,
            'The AI provider is currently unavailable. Please retry.',
        );
    }

    // Persist the summary, record EXACTLY ONE usage unit (Req 8.4), and decrement quota by
    // EXACTLY ONE (Req 9.3) — atomically, so the accounting cannot be double-counted.
    const { summary, remainingQuota } = await prisma.$transaction(async (tx) => {
        const created = await tx.noteSummary.create({
            data: {
                userId,
                inputType: validation.value.inputType,
                summary: result as unknown as Prisma.InputJsonValue,
            },
        });

        await tx.aiUsageEvent.create({
            data: { userId, outcome: 'PRODUCED', summaryId: created.id },
        });

        const updatedProfile = await tx.profile.update({
            where: { userId },
            data: { aiQuota: { decrement: 1 } },
            select: { aiQuota: true },
        });

        return { summary: created, remainingQuota: updatedProfile.aiQuota };
    });

    return Response.json({ summary, remainingQuota }, { status: 201 });
}

/**
 * Handle `GET /api/ai/summaries`. Returns the authenticated user's note summaries, newest
 * first. Scoped to `auth.user.id` for per-user isolation.
 */
export async function listSummariesHandler(
    _request: Request,
    auth: AuthContext,
): Promise<Response> {
    const summaries = await prisma.noteSummary.findMany({
        where: { userId: auth.user.id },
        orderBy: { createdAt: 'desc' },
    });
    return Response.json({ summaries });
}
