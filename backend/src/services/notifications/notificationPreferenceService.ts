import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

export async function getNotificationPreferencesHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const preferences = await prisma.notificationPreference.findUnique({ where: { userId: auth.user.id } });
    return Response.json({ preferences });
}

export async function saveNotificationPreferencesHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const booleanOrUndefined = (value: unknown) => value === undefined ? undefined : value === true;
    const preferences = await prisma.notificationPreference.upsert({
        where: { userId: auth.user.id },
        create: { userId: auth.user.id, dailyBriefing: input.dailyBriefing !== false, revisionReminders: input.revisionReminders !== false, currentAffairs: input.currentAffairs !== false, wellbeing: input.wellbeing !== false, quietStart: typeof input.quietStart === 'string' ? input.quietStart : undefined, quietEnd: typeof input.quietEnd === 'string' ? input.quietEnd : undefined },
        update: { dailyBriefing: booleanOrUndefined(input.dailyBriefing), revisionReminders: booleanOrUndefined(input.revisionReminders), currentAffairs: booleanOrUndefined(input.currentAffairs), wellbeing: booleanOrUndefined(input.wellbeing), quietStart: typeof input.quietStart === 'string' ? input.quietStart : undefined, quietEnd: typeof input.quietEnd === 'string' ? input.quietEnd : undefined },
    });
    return Response.json({ preferences });
}
