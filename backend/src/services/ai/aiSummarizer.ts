/**
 * Concrete provider implementation of {@link AiSummarizer} (task 16.1).
 *
 * This is the thin seam between the AI Notes Service and the real Gemini/Claude
 * vision/text API. It is deliberately the ONLY place a live network/provider call would
 * occur, and it is NOT exercised by the unit tests — tests inject a mock {@link AiSummarizer}
 * instead, so no API key is read and no HTTP request is made during the suite.
 *
 * The provider key is read lazily from the server-side config (`config.ai.apiKey`) so
 * importing this module never requires the secret to be present (e.g. during `next build`
 * or when only the pure logic is loaded). Wiring the actual HTTP request and the
 * model-specific prompt/response parsing is a deployment concern handled where the server
 * is started.
 */
import type { AiSummarizer, AiSummaryInput, AiSummaryResult } from './types';
import { summarizeImageWithGemini, summarizeWithGemini } from './liveProvider';

/**
 * An {@link AiSummarizer} backed by the configured vision/text-capable AI provider.
 *
 * The provider key is resolved on first use rather than at construction so this class can
 * be referenced without the secret being set. The concrete HTTP call is intentionally left
 * as the single integration point to be wired at deploy time; until then it fails loudly
 * rather than silently returning fabricated data. A thrown error here is caught by the
 * service and surfaced as `503 AI_PROVIDER_UNAVAILABLE` without charging the user.
 */
export class ProviderAiSummarizer implements AiSummarizer {
    async summarize(input: AiSummaryInput): Promise<AiSummaryResult> {
        if (input.inputType === 'TEXT') return summarizeWithGemini(input.text);
        if (!input.imageData) throw new Error('A raw image is required for live vision summarization.');
        return summarizeImageWithGemini(input.imageData, input.mimeType || 'image/jpeg');
    }
}
