/**
 * Concrete {@link NtaSource} adapter (thin network seam, Req 20.1).
 *
 * This is the only network-bound part of NTA ingestion. It fetches official NTA
 * scraper/RSS endpoints and returns the raw, UNTRUSTED items verbatim — it performs NO
 * validation or sanitization itself; that is the job of the pure pipeline
 * (`parseAndValidate` → `sanitizeText`/`computeDedupeHash`) so the trust boundary stays
 * in one well-tested place.
 *
 * Because it makes live HTTP calls it is intentionally NOT exercised by the unit tests;
 * tests inject a fixture `NtaSource` instead. The endpoints are expected to expose a
 * simple JSON array of items; richer RSS/HTML parsing can be layered in here later
 * without touching the pure pipeline downstream.
 */
import type { NtaSource, RawNtaItem } from './types';

/** Options for {@link HttpNtaSource}. */
export interface HttpNtaSourceOptions {
    /** Official source endpoints to poll (server-to-server only). */
    endpoints: string[];
    /** Optional fetch implementation (defaults to the global `fetch`). */
    fetchImpl?: typeof fetch;
}

/**
 * Fetches raw announcement items from one or more configured JSON endpoints. A failure
 * to fetch or parse any single endpoint is isolated: that endpoint contributes no items
 * rather than aborting the whole fetch, so a flaky source never blocks the others.
 */
export class HttpNtaSource implements NtaSource {
    private readonly endpoints: string[];
    private readonly fetchImpl: typeof fetch;

    constructor(options: HttpNtaSourceOptions) {
        this.endpoints = options.endpoints;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async fetchAnnouncements(): Promise<RawNtaItem[]> {
        const batches = await Promise.all(
            this.endpoints.map((endpoint) => this.fetchEndpoint(endpoint)),
        );
        return batches.flat();
    }

    private async fetchEndpoint(endpoint: string): Promise<RawNtaItem[]> {
        try {
            const response = await this.fetchImpl(endpoint);
            if (!response.ok) {
                return [];
            }
            const payload: unknown = await response.json();
            return Array.isArray(payload) ? (payload as RawNtaItem[]) : [];
        } catch {
            // Untrusted, possibly-unavailable source: never let one endpoint fail the run.
            return [];
        }
    }
}
