import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

function parseDay(value: unknown): Date | null {
    if (typeof value !== 'string') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function bounded(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function parseClock(value: unknown): string | null {
    if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
    const hours = Number(value.slice(0, 2));
    const minutes = Number(value.slice(3, 5));
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? value : null;
}

export async function saveWellbeingCheckinHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const checkinDate = parseDay(input.checkinDate) ?? parseDay(new Date().toISOString());
    const mood = bounded(input.mood);
    const energy = bounded(input.energy);
    const stress = bounded(input.stress);
    if (!checkinDate || mood === null || energy === null || stress === null) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'mood, energy and stress must be integers from 1 to 5.');
    const sleepHours = input.sleepHours === undefined ? undefined : typeof input.sleepHours === 'number' && input.sleepHours >= 0 && input.sleepHours <= 24 ? input.sleepHours : null;
    if (sleepHours === null) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'sleepHours must be between 0 and 24.');
    const checkin = await prisma.wellbeingCheckin.upsert({
        where: { userId_checkinDate: { userId: auth.user.id, checkinDate } },
        create: { userId: auth.user.id, checkinDate, mood, energy, stress, sleepHours, note: typeof input.note === 'string' ? input.note.trim() : undefined },
        update: { mood, energy, stress, sleepHours, note: typeof input.note === 'string' ? input.note.trim() : undefined },
    });
    return Response.json({ checkin }, { status: 201 });
}

export async function listWellbeingCheckinsHandler(request: Request, auth: AuthContext): Promise<Response> {
    const limitParam = Number(new URL(request.url).searchParams.get('limit') ?? 30);
    const limit = Number.isInteger(limitParam) ? Math.min(90, Math.max(1, limitParam)) : 30;
    const checkins = await prisma.wellbeingCheckin.findMany({ where: { userId: auth.user.id }, orderBy: { checkinDate: 'desc' }, take: limit });
    return Response.json({ checkins });
}

export async function getSleepScheduleHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const schedule = await prisma.sleepSchedule.findUnique({ where: { userId: auth.user.id } });
    return Response.json({ schedule });
}

export async function saveSleepScheduleHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const bedtime = parseClock(input.bedtime);
    const wakeTime = parseClock(input.wakeTime);
    const windDownMin = typeof input.windDownMin === 'number' && Number.isInteger(input.windDownMin) && input.windDownMin >= 0 && input.windDownMin <= 180 ? input.windDownMin : 30;
    if (!bedtime || !wakeTime) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'bedtime and wakeTime must use HH:mm format.');
    const schedule = await prisma.sleepSchedule.upsert({
        where: { userId: auth.user.id },
        create: { userId: auth.user.id, bedtime, wakeTime, windDownMin, enabled: input.enabled !== false },
        update: { bedtime, wakeTime, windDownMin, enabled: input.enabled !== false },
    });
    return Response.json({ schedule });
}
