import { upsertCurrentAffairsItem } from '@/services/currentAffairs';
import { dedupeHash, parseFeedPayload } from './parse';
import type { CurrentAffairsFeedItem } from './types';

export async function ingestCurrentAffairsFeed(input: { payload: unknown; sourceName: string; sourceUrl: string; examProgram?: CurrentAffairsFeedItem['examProgram'] }): Promise<number> {
    const items = parseFeedPayload(input.payload, input.sourceName, input.sourceUrl, input.examProgram);
    for (const item of items) await upsertCurrentAffairsItem({ ...item, dedupeHash: dedupeHash(item) });
    return items.length;
}

export async function fetchAndIngestCurrentAffairsFeed(input: { sourceName: string; sourceUrl: string; examProgram?: CurrentAffairsFeedItem['examProgram']; fetcher?: typeof fetch }): Promise<number> {
    const fetcher = input.fetcher ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetcher(input.sourceUrl, { headers: { accept: 'application/json, application/rss+xml, application/xml, text/xml' }, signal: controller.signal });
        if (!response.ok) throw new Error(`Current-affairs source returned ${response.status}.`);
        const contentLength = Number(response.headers.get('content-length') ?? 0);
        if (Number.isFinite(contentLength) && contentLength > 2_000_000) throw new Error('Current-affairs source response is too large.');
        const raw = await response.text();
        if (raw.length > 2_000_000) throw new Error('Current-affairs source response is too large.');
        const contentType = response.headers.get('content-type') ?? '';
        let payload: unknown = raw;
        if (contentType.includes('json')) {
            try { payload = JSON.parse(raw); } catch { throw new Error('Current-affairs source returned invalid JSON.'); }
        }
        return ingestCurrentAffairsFeed({ ...input, payload });
    } finally {
        clearTimeout(timeout);
    }
}
