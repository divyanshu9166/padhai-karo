/**
 * Concrete vision-provider implementation of {@link VisionExtractor} (task 12.1).
 *
 * This is the thin seam between the worker and the real Gemini/Claude vision API. It is
 * deliberately the ONLY place a live network/provider call would occur, and it is NOT
 * exercised by the unit tests — tests inject a mock {@link VisionExtractor} instead, so no
 * API key is read and no HTTP request is made during the suite.
 *
 * The provider key is read lazily from the server-side config (`config.ai.apiKey`) so
 * importing this module never requires the secret to be present (e.g. during `next build`
 * or when only the pure logic is loaded). Wiring the actual HTTP request and the
 * model-specific prompt/response parsing is a deployment concern handled where the worker
 * process is started; the request body shape returned by the model is then validated by
 * the untrusted-input pipeline in `extraction.ts` before anything is stored.
 */
import { getConfig } from '@/lib/config';

import type { VisionExtractionInput, VisionExtractionResult, VisionExtractor } from './types';

/**
 * A {@link VisionExtractor} backed by the configured vision-capable AI provider.
 *
 * The provider key is resolved on first use rather than at construction so this class can
 * be referenced without the secret being set. The concrete HTTP call is intentionally left
 * as the single integration point to be wired at deploy time; until then it fails loudly
 * rather than silently returning fabricated data, since fabricated questions must never
 * enter the practice corpus.
 */
export class ProviderVisionExtractor implements VisionExtractor {
    private apiKey: string | undefined;

    /** Resolve (and memoize) the provider API key from server-side config. */
    private getApiKey(): string {
        if (this.apiKey === undefined) {
            this.apiKey = getConfig().ai.apiKey;
        }
        return this.apiKey;
    }

    async extractQuestionsFromImage(
        input: VisionExtractionInput,
    ): Promise<VisionExtractionResult> {
        // Touch the key so misconfiguration surfaces here rather than mid-parse. The actual
        // provider HTTP request + model-specific response mapping is wired at deployment.
        this.getApiKey();
        void input;
        throw new Error(
            'ProviderVisionExtractor.extractQuestionsFromImage is not wired to a live provider ' +
            'in this build. Inject a VisionExtractor implementation when starting the worker.',
        );
    }
}
