/**
 * Types for the AI Notes Service (task 16.1, design "AI Notes Service (Req 8, 9)" and
 * "AI Notes Request Flow & Usage Accounting").
 *
 * The AI provider (vision/text summarization model) is abstracted behind the
 * {@link AiSummarizer} interface so tests inject a mock and no live API call runs during
 * the suite. A concrete Gemini/Claude client lives in `aiSummarizer.ts` as a thin seam
 * that is NOT exercised by tests. The service depends only on this interface.
 */

/**
 * The input to a summarization request, discriminated by `inputType`:
 *   - `TEXT`  — the user pasted note text to be summarized (Req 8.1).
 *   - `PHOTO` — the user uploaded a photo of notes to be sent to a vision-capable model
 *               (Req 8.2). `imageUploadId` references the already-uploaded image.
 *
 * This type represents an input that has ALREADY passed validation (non-empty text /
 * present image reference); it is what the provider seam receives.
 */
export type AiSummaryInput =
    | { inputType: 'TEXT'; text: string }
    | { inputType: 'PHOTO'; imageUploadId: string };

/**
 * The structured summary returned by the model and persisted as `NoteSummary.summary`
 * (Req 8.1/8.2/8.6). `keyPoints` is the required structured-key-points payload; an
 * optional `title` may be present. The shape is intentionally permissive (extra fields are
 * allowed) because the stored value is opaque JSON consumed by the client.
 */
export interface AiSummaryResult {
    /** Structured key points extracted from the note text/photo. */
    keyPoints: string[];
    /** Optional short title for the summary. */
    title?: string;
    [key: string]: unknown;
}

/**
 * The AI-provider seam. A concrete implementation (Gemini/Claude vision/text client) lives
 * in `aiSummarizer.ts`; tests supply a mock. The service depends only on this interface so
 * no live API call runs during tests.
 *
 * Implementations MUST throw on any provider/transport failure (timeout, rate limit, 5xx).
 * The service catches such failures and surfaces them as `503 AI_PROVIDER_UNAVAILABLE`
 * WITHOUT recording usage or decrementing quota (design "AI Provider Failures").
 */
export interface AiSummarizer {
    summarize(input: AiSummaryInput): Promise<AiSummaryResult>;
}
