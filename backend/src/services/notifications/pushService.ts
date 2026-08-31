import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

interface ExpoMessage { to: string; title: string; body: string; data: Record<string, unknown>; sound: 'default'; }

async function sendExpoMessages(messages: ExpoMessage[]): Promise<boolean> {
    if (messages.length === 0) return true;
    for (let offset = 0; offset < messages.length; offset += 100) {
        const batch = messages.slice(offset, offset + 100);
        const response = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(batch) });
        if (!response.ok) return false;
        try {
            const payload = await response.json() as { data?: Array<{ status?: string; details?: { error?: string } }> };
            const invalidTokens = batch.filter((_message, index) => payload.data?.[index]?.details?.error === 'DeviceNotRegistered').map((message) => message.to);
            if (invalidTokens.length > 0) await prisma.pushDevice.updateMany({ where: { expoPushToken: { in: invalidTokens } }, data: { active: false } });
        } catch { /* Expo accepted the request; receipts are optional */ }
    }
    return true;
}

/** Best-effort community notification seam shared by buddy/message services. */
export async function sendUserPushNotification(userId: string, title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
    const devices = await prisma.pushDevice.findMany({ where: { userId, active: true }, select: { expoPushToken: true } });
    await sendExpoMessages(devices.map((device) => ({ to: device.expoPushToken, title, body, data, sound: 'default' })));
}

export async function registerPushDeviceHandler(request: Request, auth: AuthContext): Promise<Response> {
    let input: Record<string, unknown>; try { input = await request.json(); } catch { input = {}; }
    const token = text(input.expoPushToken); const platform = text(input.platform) || 'unknown';
    if (!token || !token.startsWith('ExponentPushToken[')) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A valid Expo push token is required.');
    const device = await prisma.pushDevice.upsert({ where: { userId_expoPushToken: { userId: auth.user.id, expoPushToken: token } }, create: { userId: auth.user.id, expoPushToken: token, platform }, update: { platform, active: true, lastSeenAt: new Date() } });
    return Response.json({ device }, { status: 201 });
}

export async function unregisterPushDeviceHandler(request: Request, auth: AuthContext): Promise<Response> {
    let input: Record<string, unknown>; try { input = await request.json(); } catch { input = {}; }
    const token = text(input.expoPushToken);
    if (!token) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'expoPushToken is required.');
    await prisma.pushDevice.updateMany({ where: { userId: auth.user.id, expoPushToken: token }, data: { active: false } });
    return new Response(null, { status: 204 });
}

export async function sendRevisionRemindersHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const preferences = await prisma.notificationPreference.findUnique({ where: { userId: auth.user.id } });
    if (preferences?.revisionReminders === false) return Response.json({ sent: 0, skipped: 'disabled' });
    const cards = await prisma.revisionCard.findMany({ where: { userId: auth.user.id, suspended: false, dueAt: { lte: new Date() } }, orderBy: { dueAt: 'asc' }, take: 10, select: { title: true } });
    if (cards.length === 0) return Response.json({ sent: 0, skipped: 'nothing_due' });
    const devices = await prisma.pushDevice.findMany({ where: { userId: auth.user.id, active: true }, select: { expoPushToken: true } });
    if (devices.length === 0) return Response.json({ sent: 0, skipped: 'no_devices' });
    const sent = await sendExpoMessages(devices.map((device) => ({ to: device.expoPushToken, title: 'Revision time', body: cards.length === 1 ? 'One card is due for active recall.' : cards.length + ' revision cards are waiting.', data: { route: 'Revision', dueCount: cards.length }, sound: 'default' })));
    if (!sent) return errorResponse(502, ErrorCode.REFERENCE_DATA_UNAVAILABLE, 'Push notification service failed.');
    return Response.json({ sent: devices.length, dueCount: cards.length });
}

/** Deployment-cron handler. It is deliberately secret-gated and idempotent for 18 hours. */
export async function sendScheduledRevisionRemindersHandler(request: Request): Promise<Response> {
    const secret = process.env.PUSH_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
    const supplied = text(request.headers.get('x-push-cron-secret')) || text(request.headers.get('authorization')).replace(/^Bearer\s+/i, '');
    if (!secret || supplied !== secret) return errorResponse(403, ErrorCode.FORBIDDEN, 'A valid push cron secret is required.');
    const now = new Date();
    const cursor = new Date(now.getTime() - 18 * 60 * 60 * 1000);
    const devices = await prisma.pushDevice.findMany({ where: { active: true, OR: [{ lastRevisionReminderAt: null }, { lastRevisionReminderAt: { lt: cursor } }] }, select: { id: true, userId: true, expoPushToken: true } });
    const userIds = [...new Set(devices.map((device) => device.userId))];
    let usersNotified = 0;
    let devicesNotified = 0;
    for (const userId of userIds) {
        const preferences = await prisma.notificationPreference.findUnique({ where: { userId }, select: { revisionReminders: true } });
        if (preferences?.revisionReminders === false) continue;
        const cards = await prisma.revisionCard.count({ where: { userId, suspended: false, dueAt: { lte: now } } });
        if (cards === 0) continue;
        const userDevices = devices.filter((device) => device.userId === userId);
        const sent = await sendExpoMessages(userDevices.map((device) => ({ to: device.expoPushToken, title: 'Revision time', body: cards === 1 ? 'One card is due for active recall.' : `${cards} revision cards are waiting.`, data: { route: 'Revision', dueCount: cards }, sound: 'default' })));
        if (!sent) continue;
        await prisma.pushDevice.updateMany({ where: { id: { in: userDevices.map((device) => device.id) } }, data: { lastRevisionReminderAt: now } });
        usersNotified += 1;
        devicesNotified += userDevices.length;
    }
    return Response.json({ usersNotified, devicesNotified, checkedDevices: devices.length, generatedAt: now.toISOString() });
}
