import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { validateCalendarEventInput } from './calendarEventValidation';

export async function importCalendarEventsHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const provider = typeof input.provider === 'string' ? input.provider.trim().toUpperCase() : 'MANUAL';
    const rawEvents = Array.isArray(input.events) ? input.events : [];
    if (rawEvents.length > 500) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A calendar import may contain at most 500 events.');
    const valid = [] as { type: any; startDate: Date; endDate: Date }[];
    for (const raw of rawEvents) {
        if (!raw || typeof raw !== 'object') continue;
        const result = validateCalendarEventInput(raw as Record<string, unknown>);
        if (result.ok) valid.push(result.value);
    }
    const connection = await prisma.calendarConnection.upsert({ where: { userId_provider: { userId: auth.user.id, provider } }, create: { userId: auth.user.id, provider, externalCalendarId: typeof input.externalCalendarId === 'string' ? input.externalCalendarId : undefined, lastImportedAt: new Date() }, update: { externalCalendarId: typeof input.externalCalendarId === 'string' ? input.externalCalendarId : undefined, lastImportedAt: new Date() } });
    let imported = 0;
    for (const event of valid) {
        const existing = await prisma.calendarEvent.findFirst({ where: { userId: auth.user.id, type: event.type, startDate: event.startDate, endDate: event.endDate }, select: { id: true } });
        if (!existing) { await prisma.calendarEvent.create({ data: { userId: auth.user.id, type: event.type, startDate: event.startDate, endDate: event.endDate } }); imported += 1; }
    }
    return Response.json({ imported, skipped: rawEvents.length - imported, connection }, { status: 201 });
}
