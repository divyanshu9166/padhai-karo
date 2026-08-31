/**
 * Concrete vision-provider implementation of {@link VisionExtractor} (task 12.1).
 *
 * This is the thin seam between the worker and the real Gemini/Claude vision API. It is
 * deliberately the ONLY place a live network/provider call would occur, and it is NOT
 * exercised by the unit tests — tests inject a mock {@link VisionExtractor} instead, so no
 * API key is read and no HTTP request is made during the suite.
 *
 * The provider key is read lazily from server-side environment variables so importing this
 * module never requires the secret to be present (e.g. during `next build`). The provider
 * response is still untrusted and is validated by the extraction pipeline before anything is
 * stored.
 */
import { extractQuestionsWithVision, loadVisionSource } from '@/services/ai/liveProvider';
import type { VisionExtractionInput, VisionExtractionResult, VisionExtractor } from './types';

/**
 * A {@link VisionExtractor} backed by the configured vision-capable AI provider.
 *
 * The provider key is resolved on first use rather than at construction so this class can
 * be referenced without the secret being set. If the provider is unavailable it fails loudly
 * rather than silently returning fabricated data, since fabricated questions must never
 * enter the practice corpus.
 */
export class ProviderVisionExtractor implements VisionExtractor {
    async extractQuestionsFromImage(
        input: VisionExtractionInput,
    ): Promise<VisionExtractionResult> {
        if (!process.env.AI_PROVIDER_API_KEY?.trim()) throw new Error('AI vision provider is not configured.');
        const source = await loadVisionSource(input.sourceImageRef);
        const result = await extractQuestionsWithVision(source.dataUrl, source.mimeType, {
            examTrack: input.examTrack,
            year: input.year,
            subjectId: input.subjectId,
        });
        if (!result || typeof result !== 'object' || !Array.isArray((result as { questions?: unknown }).questions)) {
            throw new Error('Vision provider returned no questions array.');
        }
        return result as VisionExtractionResult;
    }
}
