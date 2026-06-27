/**
 * Property-based test for the allocation tier-gating posture (task 13.4; design
 * "Correctness Properties → Property 15").
 *
 *   - Property 15: Tier gating defaults open and blocks only designated outputs
 *     Validates: Requirements 12.1, 12.4
 *
 * Property 15 (design statement): For any allocation output and any
 * Subscription_Tier, while the output carries no Paid-tier designation the
 * request is granted to every tier; once an output is designated Paid-tier, a
 * Free-tier request for it is rejected with an upgrade-required response carrying
 * no output data, and a Paid-tier request for it is granted.
 *
 * The three allocation outputs (ALLOCATION_SIGNAL,
 * ALLOCATION_MOST_FREQUENT_CHAPTERS, ALLOCATION_SUGGESTED) are intentionally NOT
 * in PAID_ANALYTICS_OUTPUTS, so the feature defaults to Free for every tier
 * (Req 12.1, 12.4). This test asserts that default-open posture directly, and
 * also asserts the "blocks only designated outputs" half by mutating the shared
 * registry inside the property body and restoring it to empty in a `finally`,
 * with an afterEach safety-net that re-empties it.
 *
 * `assertTierAllowed` is pure (no Prisma, no framework), so this test needs no
 * mocks. fast-check assertions run a minimum of 100 iterations each.
 */
import type { SubscriptionTier } from '@prisma/client';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import {
    AnalyticsOutput,
    PAID_ANALYTICS_OUTPUTS,
    assertTierAllowed,
} from '../analytics/tierGate';

/** The three allocation outputs gated through the shared analytics tier seam. */
const ALLOCATION_OUTPUTS = [
    AnalyticsOutput.ALLOCATION_SIGNAL,
    AnalyticsOutput.ALLOCATION_MOST_FREQUENT_CHAPTERS,
    AnalyticsOutput.ALLOCATION_SUGGESTED,
] as const;

const TIERS: SubscriptionTier[] = ['FREE', 'PAID'];

function resetRegistry(): void {
    PAID_ANALYTICS_OUTPUTS.clear();
}

describe('allocation tierGate — Property 15: defaults open, blocks only designated outputs (Req 12.1, 12.4)', () => {
    // Restore the registry to empty after every case so no test leaks a paid designation.
    afterEach(resetRegistry);

    // Feature: weightage-based-time-allocation, Property 15: Tier gating defaults open and
    // blocks only designated outputs
    it('Property 15: grants every allocation output to every tier while none is designated Paid (Req 12.1, 12.4)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALLOCATION_OUTPUTS),
                fc.constantFrom(...TIERS),
                (output, tier) => {
                    // The default registry carries no allocation output, so the feature is
                    // open to every Subscription_Tier (Req 12.1, 12.4).
                    resetRegistry();
                    expect(PAID_ANALYTICS_OUTPUTS.has(output)).toBe(false);
                    expect(assertTierAllowed(output, tier)).toBeNull();
                },
            ),
            { numRuns: 100 },
        );
    });

    // Feature: weightage-based-time-allocation, Property 15: Tier gating defaults open and
    // blocks only designated outputs
    it('Property 15: only designated (Paid-set) outputs block FREE; PAID always granted (Req 12.1, 12.4)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALLOCATION_OUTPUTS),
                fc.constantFrom(...TIERS),
                // An arbitrary subset of allocation outputs designated Paid-tier.
                fc.subarray([...ALLOCATION_OUTPUTS]),
                (output, tier, paidSubset) => {
                    resetRegistry();
                    try {
                        for (const paid of paidSubset) {
                            PAID_ANALYTICS_OUTPUTS.add(paid);
                        }

                        const result = assertTierAllowed(output, tier);
                        const isDesignatedPaid = PAID_ANALYTICS_OUTPUTS.has(output);

                        if (tier === 'FREE' && isDesignatedPaid) {
                            // A designated output blocks a FREE request with a 402
                            // upgrade-required response carrying no output data (Req 12.4).
                            expect(result).not.toBeNull();
                            expect(result).toBeInstanceOf(Response);
                            expect(result?.status).toBe(402);
                        } else {
                            // Non-designated outputs are granted to every tier (Req 12.1),
                            // and PAID requests are always granted.
                            expect(result).toBeNull();
                        }
                    } finally {
                        resetRegistry();
                    }
                },
            ),
            { numRuns: 100 },
        );

        // The registry is empty again after the property completes — no leaked designation.
        expect(PAID_ANALYTICS_OUTPUTS.size).toBe(0);
    });
});
