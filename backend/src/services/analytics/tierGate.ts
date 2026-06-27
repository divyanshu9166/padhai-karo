/**
 * Monetization gating seam for Performance Analytics (Req 16).
 *
 * Per the design "Monetization gating seam": a single module owns the decision of whether
 * a given analytics output is Free- or Paid-tier. Every analytics handler calls
 * {@link assertTierAllowed} immediately after auth (right where the AI-notes handler does
 * its tier gate). The actual decision is centralized here so designating an output Paid is
 * a one-line edit to {@link PAID_ANALYTICS_OUTPUTS} — no call site changes.
 *
 * Defaults (Req 16.1, 16.3): {@link PAID_ANALYTICS_OUTPUTS} is EMPTY, so while nothing is
 * designated Paid every output is granted to every Subscription_Tier. When the product
 * owner adds an output to the registry, FREE-tier requests for that output are rejected
 * with the Phase 1 `402 UPGRADE_REQUIRED` envelope (Req 16.2) — the same code/shape used by
 * the AI-notes paywall (`lib/errors` + `ErrorCode.UPGRADE_REQUIRED`) rather than a new code.
 * PAID-tier requests are always allowed.
 */
import type { SubscriptionTier } from '@prisma/client';

import { ErrorCode, errorResponse } from '@/lib/errors';

/**
 * The enumerated Performance Analytics outputs that can be gated. These are stable string
 * identifiers (one per analytics insight surfaced by the Analytics_Service) used as the
 * keys of the paid-output registry and as the argument to {@link assertTierAllowed}.
 *
 * Authored as a const object + companion type, matching the Phase 1 `ErrorCode` style.
 */
export const AnalyticsOutput = {
    SCORE_TRAJECTORY: 'SCORE_TRAJECTORY',
    RANK_PREDICTION: 'RANK_PREDICTION',
    SCORE_GAP: 'SCORE_GAP',
    TOPIC_TRENDS: 'TOPIC_TRENDS',
    TOPIC_PRIORITY: 'TOPIC_PRIORITY',
    ATTEMPT_QUALITY: 'ATTEMPT_QUALITY',
    ATTEMPT_QUALITY_TREND: 'ATTEMPT_QUALITY_TREND',
    WEAK_AREAS: 'WEAK_AREAS',
} as const;

export type AnalyticsOutput = (typeof AnalyticsOutput)[keyof typeof AnalyticsOutput];

/**
 * Registry of analytics outputs designated Paid-tier. EMPTY by default (Req 16.1, 16.3):
 * while empty, every output is free for every tier. To make an output Paid, add its
 * {@link AnalyticsOutput} value here — that is the only change required (Req 16.2).
 */
export const PAID_ANALYTICS_OUTPUTS: Set<AnalyticsOutput> = new Set<AnalyticsOutput>();

/**
 * Tier guard for a single analytics output, mirroring the Phase 1 AI-notes paywall.
 *
 * Returns a `402 UPGRADE_REQUIRED` error response ONLY when a FREE-tier user requests an
 * output present in {@link PAID_ANALYTICS_OUTPUTS} (Req 16.2). Otherwise it returns `null`,
 * signalling the caller to proceed:
 *   - PAID-tier requests are always allowed (Req 16.1).
 *   - While {@link PAID_ANALYTICS_OUTPUTS} is empty, every output is allowed for every tier
 *     (Req 16.3).
 *
 * Handlers use it directly after auth, e.g.:
 * ```ts
 * const gate = assertTierAllowed(AnalyticsOutput.WEAK_AREAS, profile.subscriptionTier);
 * if (gate) return gate;
 * ```
 *
 * @param output - the analytics output being requested.
 * @param tier - the requesting user's Subscription_Tier (`FREE` | `PAID`).
 * @returns a 402 `UPGRADE_REQUIRED` {@link Response} when blocked, otherwise `null`.
 */
export function assertTierAllowed(
    output: AnalyticsOutput,
    tier: SubscriptionTier,
): Response | null {
    if (tier === 'FREE' && PAID_ANALYTICS_OUTPUTS.has(output)) {
        return errorResponse(
            402,
            ErrorCode.UPGRADE_REQUIRED,
            'This analytics feature requires a paid subscription.',
        );
    }
    return null;
}
