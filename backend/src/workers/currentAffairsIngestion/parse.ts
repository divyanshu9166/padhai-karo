import { createHash } from 'node:crypto';
import type { CurrentAffairsFeedItem } from './types';

function stripMarkup(value: string): string { return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim(); }
function first(value: unknown): string { return typeof value === 'string' ? stripMarkup(value) : ''; }

export function dedupeHash(item: CurrentAffairsFeedItem): string { return createHash('sha256').update(`${item.sourceUrl}|${item.title}|${item.publishedAt.toISOString()}`).digest('hex'); }

export function parseFeedPayload(payload: unknown, sourceName: string, sourceUrl: string, examProgram?: CurrentAffairsFeedItem['examProgram']): CurrentAffairsFeedItem[] {
    if (typeof payload === 'object' && payload !== null && Array.isArray((payload as { items?: unknown }).items)) {
        return (payload as { items: unknown[] }).items.flatMap((raw) => {
            if (!raw || typeof raw !== 'object') return [];
            const row = raw as Record<string, unknown>;
            const title = first(row.title); const summary = first(row.summary ?? row.description);
            const publishedAt = new Date(typeof row.publishedAt === 'string' ? row.publishedAt : Date.now());
            return title && !Number.isNaN(publishedAt.getTime()) ? [{ title, summary: summary || title, body: first(row.body), category: first(row.category) || 'GENERAL', tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [], sourceName, sourceUrl, publishedAt, examProgram }] : [];
        });
    }
    if (typeof payload !== 'string') return [];
    return [...payload.matchAll(/<item[\s\S]*?<\/item>/gi)].flatMap((match) => {
        const block = match[0];
        const title = first(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
        const summary = first(block.match(/<(?:description|summary)[^>]*>([\s\S]*?)<\/(?:description|summary)>/i)?.[1]);
        const dateText = first(block.match(/<(?:pubDate|published)[^>]*>([\s\S]*?)<\/(?:pubDate|published)>/i)?.[1]);
        const publishedAt = dateText ? new Date(dateText) : new Date();
        return title && !Number.isNaN(publishedAt.getTime()) ? [{ title, summary: summary || title, category: 'GENERAL', tags: [], sourceName, sourceUrl, publishedAt, examProgram }] : [];
    });
}
