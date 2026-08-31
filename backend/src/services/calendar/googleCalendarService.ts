import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { validateCalendarEventInput } from './calendarEventValidation';

function setting(name: string): string { return process.env[name]?.trim() ?? ''; }
function cryptoKey(): Buffer {
    const configured = setting('CALENDAR_TOKEN_ENCRYPTION_KEY') || setting('APP_ENCRYPTION_KEY');
    if (!configured && process.env.NODE_ENV === 'production') throw new Error('Calendar token encryption requires CALENDAR_TOKEN_ENCRYPTION_KEY or APP_ENCRYPTION_KEY.');
    return createHash('sha256').update(configured || 'development-only-calendar-key').digest();
}
function encrypt(value: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', cryptoKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
function decrypt(value: string): string {
    const [iv, tag, encrypted] = value.split('.'); const decipher = createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export async function getGoogleConnectUrlHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const clientId = setting('GOOGLE_CLIENT_ID'); const redirectUri = setting('GOOGLE_REDIRECT_URI');
    if (!clientId || !redirectUri) return errorResponse(503, ErrorCode.REFERENCE_DATA_UNAVAILABLE, 'Google Calendar OAuth is not configured.');
    const state = randomBytes(24).toString('base64url');
    await prisma.calendarOAuthState.create({ data: { userId: auth.user.id, state, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/calendar.readonly', state });
    return Response.json({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), state });
}

export async function googleOAuthCallbackHandler(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams; const state = params.get('state') ?? ''; const code = params.get('code') ?? '';
    const oauthState = await prisma.calendarOAuthState.findUnique({ where: { state } });
    if (!oauthState || oauthState.expiresAt < new Date() || !code) return errorResponse(400, ErrorCode.VALIDATION_ERROR, 'The Google Calendar authorization state is invalid or expired.');
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: setting('GOOGLE_CLIENT_ID'), client_secret: setting('GOOGLE_CLIENT_SECRET'), redirect_uri: setting('GOOGLE_REDIRECT_URI'), grant_type: 'authorization_code' }) });
    if (!response.ok) return errorResponse(502, ErrorCode.REFERENCE_DATA_UNAVAILABLE, 'Google did not return an access token.');
    const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!token.access_token) return errorResponse(502, ErrorCode.REFERENCE_DATA_UNAVAILABLE, 'Google returned an incomplete token response.');
    await prisma.calendarConnection.upsert({ where: { userId_provider: { userId: oauthState.userId, provider: 'GOOGLE' } }, create: { userId: oauthState.userId, provider: 'GOOGLE', accessTokenCipher: encrypt(token.access_token), refreshTokenCipher: token.refresh_token ? encrypt(token.refresh_token) : undefined, tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000), lastImportedAt: null }, update: { accessTokenCipher: encrypt(token.access_token), refreshTokenCipher: token.refresh_token ? encrypt(token.refresh_token) : undefined, tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000) } });
    await prisma.calendarOAuthState.delete({ where: { id: oauthState.id } });
    const appReturn = setting('GOOGLE_APP_RETURN_URI');
    if (appReturn) return Response.redirect(`${appReturn}?connected=1`);
    return Response.json({ connected: true, message: 'Google Calendar connected. You can return to PadhaiKaro and import events.' });
}

async function accessToken(connection: { accessTokenCipher: string | null; refreshTokenCipher: string | null; tokenExpiresAt: Date | null }, userId: string): Promise<string> {
    if (connection.accessTokenCipher && connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() > Date.now() + 60_000) return decrypt(connection.accessTokenCipher);
    if (!connection.refreshTokenCipher) throw new Error('Google Calendar needs to be connected again.');
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: setting('GOOGLE_CLIENT_ID'), client_secret: setting('GOOGLE_CLIENT_SECRET'), refresh_token: decrypt(connection.refreshTokenCipher), grant_type: 'refresh_token' }) });
    if (!response.ok) throw new Error('Google token refresh failed.');
    const token = await response.json() as { access_token?: string; expires_in?: number };
    if (!token.access_token) throw new Error('Google token refresh returned no access token.');
    await prisma.calendarConnection.update({ where: { userId_provider: { userId, provider: 'GOOGLE' } }, data: { accessTokenCipher: encrypt(token.access_token), tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000) } });
    return token.access_token;
}

export async function importGoogleCalendarHandler(request: Request, auth: AuthContext): Promise<Response> {
    const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: auth.user.id, provider: 'GOOGLE' } } });
    if (!connection) return errorResponse(404, ErrorCode.NOT_FOUND, 'Connect Google Calendar before importing events.');
    try {
        const token = await accessToken(connection, auth.user.id);
        const now = new Date(); const until = new Date(now); until.setUTCDate(until.getUTCDate() + 90);
        const query: Record<string, string> = connection.syncToken
            ? { syncToken: connection.syncToken, singleEvents: 'true', maxResults: '250' }
            : { timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' };
        let response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams(query).toString(), { headers: { Authorization: 'Bearer ' + token } });
        if (response.status === 410 && connection.syncToken) {
            await prisma.calendarConnection.update({ where: { id: connection.id }, data: { syncToken: null } });
            response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams({ timeMin: now.toISOString(), timeMax: until.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' }).toString(), { headers: { Authorization: 'Bearer ' + token } });
        }
        if (!response.ok) throw new Error('Google Calendar events request failed.');
        const payload = await response.json() as { nextSyncToken?: string; items?: Array<{ id?: string; status?: string; summary?: string; description?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private?: Record<string, string> } }> };
        const cancelled = (payload.items ?? []).filter((event) => event.status === 'cancelled' && event.id).map((event) => event.id as string);
        if (cancelled.length > 0) await prisma.calendarEvent.deleteMany({ where: { userId: auth.user.id, source: 'GOOGLE', externalId: { in: cancelled } } });
        const valid = (payload.items ?? []).filter((event) => event.status !== 'cancelled').flatMap((event) => {
            const startDate = event.start?.dateTime ?? event.start?.date; const endDate = event.end?.dateTime ?? event.end?.date;
            const text = `${event.summary ?? ''} ${event.description ?? ''} ${(event.extendedProperties?.private?.padhaikaroType ?? '')}`.toLowerCase();
            const type = text.includes('mock') || text.includes('test') ? 'MOCK_TEST' : text.includes('holiday') || text.includes('leave') || text.includes('vacation') ? 'HOLIDAY' : 'SCHOOL_EXAM';
            const checked = validateCalendarEventInput({ type, startDate, endDate });
            return checked.ok ? [{ ...checked.value, externalId: event.id, source: 'GOOGLE' as const }] : [];
        });
        let imported = 0;
        for (const event of valid) {
            const existing = event.externalId ? await prisma.calendarEvent.findUnique({ where: { userId_externalId: { userId: auth.user.id, externalId: event.externalId } }, select: { id: true } }) : await prisma.calendarEvent.findFirst({ where: { userId: auth.user.id, type: event.type, startDate: event.startDate, endDate: event.endDate }, select: { id: true } });
            if (existing) await prisma.calendarEvent.update({ where: { id: existing.id }, data: { type: event.type, startDate: event.startDate, endDate: event.endDate, source: 'GOOGLE', externalId: event.externalId } });
            else { await prisma.calendarEvent.create({ data: { userId: auth.user.id, ...event } }); imported += 1; }
        }
        await prisma.calendarConnection.update({ where: { id: connection.id }, data: { lastImportedAt: new Date(), status: 'CONNECTED', syncToken: payload.nextSyncToken ?? connection.syncToken } });
        return Response.json({ imported, skipped: (payload.items ?? []).length - imported });
    } catch (error) {
        return errorResponse(502, ErrorCode.REFERENCE_DATA_UNAVAILABLE, error instanceof Error ? error.message : 'Google Calendar import failed.');
    }
}

export async function getGoogleCalendarStatusHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: auth.user.id, provider: 'GOOGLE' } }, select: { provider: true, status: true, lastImportedAt: true, externalCalendarId: true } });
    return Response.json({ connected: Boolean(connection), connection });
}

export async function disconnectGoogleCalendarHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: auth.user.id, provider: 'GOOGLE' } }, select: { id: true, accessTokenCipher: true } });
    if (!connection) return new Response(null, { status: 204 });
    if (connection.accessTokenCipher) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(decrypt(connection.accessTokenCipher)), { method: 'POST' }); } catch { /* revoke is best effort; local tokens are still removed */ } }
    await prisma.$transaction([prisma.calendarEvent.deleteMany({ where: { userId: auth.user.id, source: 'GOOGLE' } }), prisma.calendarConnection.delete({ where: { id: connection.id } })]);
    return new Response(null, { status: 204 });
}

/** Run incremental imports for connected users from the deployment scheduler. */
export async function syncConnectedGoogleCalendars(): Promise<{ checked: number; imported: number; failed: number }> {
    const connections = await prisma.calendarConnection.findMany({ where: { provider: 'GOOGLE', status: 'CONNECTED' }, select: { userId: true } });
    let imported = 0; let failed = 0;
    for (const connection of connections) {
        try {
            const response = await importGoogleCalendarHandler(new Request('http://scheduler.local/api/calendar/google/import', { method: 'POST' }), { user: { id: connection.userId } } as AuthContext);
            if (response.ok) {
                const body = await response.json() as { imported?: number };
                imported += body.imported ?? 0;
            } else failed += 1;
        } catch { failed += 1; }
    }
    return { checked: connections.length, imported, failed };
}

/** Deployment-cron handler for incremental imports from connected calendars. */
export async function syncGoogleCalendarsCronHandler(request: Request): Promise<Response> {
    const secret = setting('CALENDAR_CRON_SECRET') || setting('CRON_SECRET');
    const supplied = request.headers.get('x-calendar-cron-secret')?.trim()
        || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!secret || supplied !== secret) return errorResponse(403, ErrorCode.FORBIDDEN, 'A valid calendar cron secret is required.');
    return Response.json(await syncConnectedGoogleCalendars());
}
