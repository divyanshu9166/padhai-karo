import type { AuthContext } from '@/lib/auth';
import { fetchAndIngestCurrentAffairsFeed } from '@/workers/currentAffairsIngestion';
import { ErrorCode, errorResponse } from '@/lib/errors';

interface FeedConfig { sourceName: string; sourceUrl: string; examProgram?: 'UPSC_CSE' | 'SSC_CGL'; verifiedOfficial: true }

const DEFAULT_FEEDS: FeedConfig[] = [
    { sourceName: 'PIB official releases', sourceUrl: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', verifiedOfficial: true },
];

const VERIFIED_OFFICIAL_HOSTS = [
    'upsc.gov.in',
    'ssc.gov.in',
    'pib.gov.in',
    'prsindia.org',
    'rbi.org.in',
    'indiabudget.gov.in',
] as const;

function isVerifiedOfficialUrl(sourceUrl: string): boolean {
    try {
        const hostname = new URL(sourceUrl).hostname.toLowerCase();
        return VERIFIED_OFFICIAL_HOSTS.some((host) => hostname === host || hostname.endsWith('.' + host));
    } catch {
        return false;
    }
}

function feeds(): FeedConfig[] {
    const raw = process.env.CURRENT_AFFAIRS_FEEDS?.trim();
    if (!raw) return DEFAULT_FEEDS;
    const output: FeedConfig[] = [];
    for (const entry of raw.split(',')) {
        const [sourceName, sourceUrl, examProgram] = entry.split('|').map((value) => value.trim());
        if (sourceName && /^https:\/\//i.test(sourceUrl) && isVerifiedOfficialUrl(sourceUrl)) output.push({ sourceName, sourceUrl, verifiedOfficial: true, ...(examProgram === 'UPSC_CSE' || examProgram === 'SSC_CGL' ? { examProgram } : {}) });
    }
    return output;
}

export async function refreshCurrentAffairsHandler(_request: Request, _auth: AuthContext): Promise<Response> {
    const configured = feeds();
    if (configured.length === 0) return errorResponse(503, ErrorCode.REFERENCE_DATA_UNAVAILABLE, 'CURRENT_AFFAIRS_FEEDS contains no valid verified official entries.');
    const results: Array<{ sourceName: string; imported: number; error?: string }> = [];
    for (const feed of configured) {
        try { results.push({ sourceName: feed.sourceName, imported: await fetchAndIngestCurrentAffairsFeed(feed) }); }
        catch (error) { results.push({ sourceName: feed.sourceName, imported: 0, error: error instanceof Error ? error.message : 'Feed failed' }); }
    }
    return Response.json({ results, imported: results.reduce((sum, item) => sum + item.imported, 0) });
}

/** Scheduler-safe refresh seam. A deployment cron can call this without creating a user session. */
export async function refreshCurrentAffairsCronHandler(request: Request): Promise<Response> {
    const secret = process.env.CURRENT_AFFAIRS_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
    const supplied = request.headers.get('x-current-affairs-cron-secret')?.trim() || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!secret || supplied !== secret) return errorResponse(403, ErrorCode.FORBIDDEN, 'A valid current-affairs cron secret is required.');
    return refreshCurrentAffairsHandler(request, { user: { id: 'system-current-affairs' } } as AuthContext);
}
