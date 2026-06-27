/**
 * Property test for the Performance Analytics monetization gating seam (Req 16).
 *
 * Property 19: Tier-gating decision. For any analytics output and subscription tier, the
 * gate grants access (returns null) when the output is not in the paid-output registry (so
 * every output is granted while the registry is empty), rejects a FREE-tier request for a
 * designated-paid output with a 402 UPGRADE_REQUIRED response, and always grants PAID-tier
 * requests.
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the {@link assertTierAllowed} / {@link PAID_ANALYTICS_OUTPUTS}
 * logic it validates. Because the registry is an empty const Set by default, the "designated
 * paid" branch is exercised by mutating the registry inside the property body and restoring it
 * to empty in a `finally`, with an afterEach safety-net that re-empties it.
 */
import type { SubscriptionTier } from '@prisma/client';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { AnalyticsOutput, PAID_ANALYTICS_OUTPUTS, assertTierAllowed } from './tierGate';

const ALL_OUTPUTS = Object.values(AnalyticsOutput) as AnalyticsOutput[];
const TIERS: SubscriptionTier[] = ['FREE', 'PAID'];

function resetRegistry(): void {
    PAID_ANALYTICS_OUTPUTS.clear();
}

describe('tierGate — Property 19: tier-gating decision (Req 16.1, 16.2, 16.3)', () => {
    // Restore the registry to empty after every case so no test leaks paid designations.
    afterEach(resetRegistry);

    // Feature: performance-analytics, Property 19: For any analytics output and subscription
    // tier, the gate grants access when the output is not in the paid registry (all outputs
    // granted while empty), rejects a FREE-tier request for a designated-paid output with a
    // 402 upgrade-required response, and always grants PAID-tier requests.
    it('grants while empty, rejects only designated-paid FREE requests, always grants PAID', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...ALL_OUTPUTS),
                fc.constantFrom(...TIERS),
                // An arbitrary subset of outputs designated as paid.
                fc.subarray(ALL_OUTPUTS),
                (output, tier, paidSubset) => {
                    // --- Req 16.1, 16.3: empty registry => every output granted for every tier.
                    resetRegistry();
                    expect(PAID_ANALYTICS_OUTPUTS.size).toBe(0);
                    expect(assertTierAllowed(output, tier)).toBeNull();

                    // --- Designate the arbitrary subset as paid, then check the decision.
                    try {
                        for (const paid of paidSubset) {
                            PAID_ANALYTICS_OUTPUTS.add(paid);
                        }

                        const result = assertTierAllowed(output, tier);
                        const isDesignatedPaid = PAID_ANALYTICS_OUTPUTS.has(output);

                        if (tier === 'FREE' && isDesignatedPaid) {
                            // Req 16.2: FREE-tier request for a paid output is rejected with 402.
                            expect(result).not.toBeNull();
                            expect(result).toBeInstanceOf(Response);
                            expect(result?.status).toBe(402);
                        } else {
                            // Req 16.1/16.3: PAID always granted; FREE granted for non-paid outputs.
                            expect(result).toBeNull();
                        }
                    } finally {
                        // Restore the registry to empty regardless of assertion outcome.
                        resetRegistry();
                    }
                },
            ),
        );

        // Registry is empty again after the property completes.
        expect(PAID_ANALYTICS_OUTPUTS.size).toBe(0);
    });
});
