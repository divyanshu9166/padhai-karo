import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { editBlockHandler, deleteBlockHandler } from '@/services/timetable/blockEditService';
import { generateTimetableHandler } from '@/services/timetable/timetableGenerationService';
import { missedBlockHandler } from '@/services/timetable/rebalanceService';

type MutationInput = { clientId: string; type: string; payload: Record<string, unknown> };
type MutationResult = { clientId: string; status: 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'ERROR'; serverId?: string; message?: string; conflict?: Record<string, unknown> };

class OfflineConflictError extends Error {
    constructor(public readonly details: Record<string, unknown>) {
        super('This offline change is based on an older server version.');
        this.name = 'OfflineConflictError';
    }
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function list(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 30) : []; }
function integer(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isInteger(value) ? value : fallback; }

function assertFreshVersion(existing: { updatedAt: Date }, payload: Record<string, unknown>, server: Record<string, unknown>): void {
    const raw = stringValue(payload.baseUpdatedAt);
    if (!raw) return;
    const base = new Date(raw);
    if (Number.isNaN(base.getTime())) throw new Error('baseUpdatedAt must be a valid ISO timestamp.');
    if (existing.updatedAt.getTime() > base.getTime()) throw new OfflineConflictError({ updatedAt: existing.updatedAt.toISOString(), record: server });
}

async function responseError(response: Response): Promise<Error> {
    let message = `Offline mutation failed with status ${response.status}.`;
    try { const body = await response.json() as { error?: { message?: string } }; message = body.error?.message || message; } catch { /* keep generic */ }
    return new Error(message);
}

async function applyMutation(auth: AuthContext, mutation: MutationInput): Promise<string | undefined> {
    const payload = mutation.payload;
    switch (mutation.type) {
        case 'RESOURCE_CREATE': {
            const title = stringValue(payload.title); if (!title) throw new Error('Resource title is required.');
            const resource = await prisma.studyResource.create({ data: { id: stringValue(payload.id) || undefined, userId: auth.user.id, title, url: stringValue(payload.url) || undefined, type: stringValue(payload.resourceType) || 'LINK', tags: list(payload.tags), subjectId: stringValue(payload.subjectId) || undefined, chapterId: stringValue(payload.chapterId) || undefined } });
            return resource.id;
        }
        case 'RESOURCE_UPDATE': {
            const id = stringValue(payload.id); if (!id) throw new Error('Resource id is required.');
            const existing = await prisma.studyResource.findFirst({ where: { id, userId: auth.user.id } }); if (!existing) throw new Error('Resource not found.');
            assertFreshVersion(existing, payload, { id: existing.id, title: existing.title, url: existing.url, tags: existing.tags, completed: existing.completed, updatedAt: existing.updatedAt.toISOString() });
            const updated = await prisma.studyResource.update({ where: { id }, data: { title: payload.title === undefined ? undefined : stringValue(payload.title), url: payload.url === undefined ? undefined : stringValue(payload.url) || null, tags: payload.tags === undefined ? undefined : list(payload.tags), completed: payload.completed === undefined ? undefined : payload.completed === true } });
            return updated.id;
        }
        case 'RESOURCE_DELETE': {
            const id = stringValue(payload.id); if (!id) throw new Error('Resource id is required.');
            const existing = await prisma.studyResource.findFirst({ where: { id, userId: auth.user.id } }); if (!existing) return id;
            assertFreshVersion(existing, payload, { id: existing.id, title: existing.title, url: existing.url, tags: existing.tags, completed: existing.completed, updatedAt: existing.updatedAt.toISOString() });
            await prisma.studyResource.delete({ where: { id: existing.id } }); return id;
        }
        case 'PDF_ANNOTATION_CREATE': {
            const documentId = stringValue(payload.documentId); const document = await prisma.pdfDocument.findFirst({ where: { id: documentId, userId: auth.user.id }, select: { id: true } });
            if (!document) throw new Error('PDF document not found.');
            const page = Math.max(1, integer(payload.page, 1));
            const annotation = await prisma.pdfAnnotation.create({ data: { id: stringValue(payload.id) || undefined, userId: auth.user.id, documentId, page, type: stringValue(payload.type) || 'HIGHLIGHT', quote: stringValue(payload.quote) || undefined, note: stringValue(payload.note) || undefined, selectionStart: integer(payload.selectionStart, -1) >= 0 ? integer(payload.selectionStart) : undefined, selectionEnd: integer(payload.selectionEnd, -1) >= 0 ? integer(payload.selectionEnd) : undefined, rect: record(payload.rect) ? payload.rect as Prisma.InputJsonValue : undefined } });
            return annotation.id;
        }
        case 'PDF_ANNOTATION_UPDATE': {
            const id = stringValue(payload.id); if (!id) throw new Error('Annotation id is required.');
            const existing = await prisma.pdfAnnotation.findFirst({ where: { id, userId: auth.user.id } }); if (!existing) throw new Error('Annotation not found.');
            assertFreshVersion(existing, payload, { id: existing.id, documentId: existing.documentId, page: existing.page, note: existing.note, quote: existing.quote, updatedAt: existing.updatedAt.toISOString() });
            const updated = await prisma.pdfAnnotation.update({ where: { id }, data: { page: payload.page === undefined ? undefined : Math.max(1, integer(payload.page, existing.page)), type: payload.type === undefined ? undefined : stringValue(payload.type), quote: payload.quote === undefined ? undefined : stringValue(payload.quote) || null, note: payload.note === undefined ? undefined : stringValue(payload.note) || null, selectionStart: payload.selectionStart === undefined ? undefined : integer(payload.selectionStart, -1) >= 0 ? integer(payload.selectionStart) : null, selectionEnd: payload.selectionEnd === undefined ? undefined : integer(payload.selectionEnd, -1) >= 0 ? integer(payload.selectionEnd) : null, rect: payload.rect === undefined ? undefined : record(payload.rect) ? payload.rect as Prisma.InputJsonValue : Prisma.JsonNull } });
            return updated.id;
        }
        case 'PDF_ANNOTATION_DELETE': {
            const id = stringValue(payload.id); if (!id) throw new Error('Annotation id is required.');
            const existing = await prisma.pdfAnnotation.findFirst({ where: { id, userId: auth.user.id } }); if (!existing) return id;
            assertFreshVersion(existing, payload, { id: existing.id, documentId: existing.documentId, page: existing.page, note: existing.note, quote: existing.quote, updatedAt: existing.updatedAt.toISOString() });
            await prisma.pdfAnnotation.delete({ where: { id: existing.id } }); return id;
        }
        case 'TIMETABLE_BLOCK_UPDATE': {
            const id = stringValue(payload.id); if (!id) throw new Error('Study block id is required.');
            const existing = await prisma.studyBlock.findFirst({ where: { id, userId: auth.user.id } }); if (!existing) throw new Error('Study block not found.');
            assertFreshVersion(existing, payload, { id: existing.id, startTime: existing.startTime.toISOString(), durationMin: existing.durationMin, updatedAt: existing.updatedAt.toISOString() });
            const patch = record(payload.patch) ? payload.patch : {};
            const response = await editBlockHandler(new Request('http://offline.local', { method: 'PATCH', body: JSON.stringify(patch) }), auth, { params: { id } });
            if (!response.ok) throw await responseError(response);
            return id;
        }
        case 'TIMETABLE_BLOCK_DELETE': {
            const id = stringValue(payload.id); if (!id) throw new Error('Study block id is required.');
            const existing = await prisma.studyBlock.findFirst({ where: { id, userId: auth.user.id } }); if (!existing) return id;
            assertFreshVersion(existing, payload, { id: existing.id, startTime: existing.startTime.toISOString(), durationMin: existing.durationMin, updatedAt: existing.updatedAt.toISOString() });
            const response = await deleteBlockHandler(new Request('http://offline.local', { method: 'DELETE' }), auth, { params: { id } });
            if (!response.ok) throw await responseError(response);
            return id;
        }
        case 'TIMETABLE_BLOCK_MISSED': {
            const id = stringValue(payload.id); if (!id) throw new Error('Study block id is required.');
            const existing = await prisma.studyBlock.findFirst({ where: { id, userId: auth.user.id } }); if (!existing) return id;
            assertFreshVersion(existing, payload, { id: existing.id, startTime: existing.startTime.toISOString(), durationMin: existing.durationMin, updatedAt: existing.updatedAt.toISOString() });
            const response = await missedBlockHandler(new Request('http://offline.local', { method: 'POST' }), auth, { params: { id } });
            if (!response.ok) throw await responseError(response);
            return id;
        }
        case 'TIMETABLE_GENERATE': {
            const weekStart = stringValue(payload.weekStart); if (!weekStart) throw new Error('weekStart is required.');
            const response = await generateTimetableHandler(new Request('http://offline.local', { method: 'POST', body: JSON.stringify({ weekStart }) }), auth);
            if (!response.ok) throw await responseError(response);
            const output = await response.json() as { timetable?: { id?: string } };
            return output.timetable?.id;
        }
        case 'CALENDAR_EVENT_CREATE': {
            const type = stringValue(payload.type); const startDate = new Date(stringValue(payload.startDate)); const endDate = new Date(stringValue(payload.endDate));
            if (!['SCHOOL_EXAM', 'HOLIDAY', 'MOCK_TEST'].includes(type) || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) throw new Error('Calendar event is invalid.');
            const event = await prisma.calendarEvent.create({ data: { userId: auth.user.id, type: type as 'SCHOOL_EXAM' | 'HOLIDAY' | 'MOCK_TEST', startDate, endDate } }); return event.id;
        }
        default: throw new Error(`Unsupported offline mutation type: ${mutation.type}`);
    }
}

export async function offlineMutationsHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!record(body) || !Array.isArray(body.records) || body.records.length > 100) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'records must be an array of at most 100 offline mutations.');
    const results: MutationResult[] = [];
    for (const raw of body.records) {
        if (!record(raw) || !stringValue(raw.clientId) || !stringValue(raw.type) || !record(raw.payload)) { results.push({ clientId: stringValue(record(raw) ? raw.clientId : ''), status: 'ERROR', message: 'clientId, type and payload are required.' }); continue; }
        const mutation: MutationInput = { clientId: stringValue(raw.clientId), type: stringValue(raw.type), payload: raw.payload };
        const existing = await prisma.offlineMutation.findUnique({ where: { userId_clientId: { userId: auth.user.id, clientId: mutation.clientId } }, select: { status: true, payload: true } });
        if (existing?.status === 'APPLIED') { results.push({ clientId: mutation.clientId, status: 'DUPLICATE', serverId: record(existing.payload) && typeof existing.payload.serverId === 'string' ? existing.payload.serverId : undefined }); continue; }
        try {
            const serverId = await applyMutation(auth, mutation);
            await prisma.offlineMutation.upsert({ where: { userId_clientId: { userId: auth.user.id, clientId: mutation.clientId } }, create: { userId: auth.user.id, clientId: mutation.clientId, type: mutation.type, payload: { ...mutation.payload, serverId } as Prisma.InputJsonValue, status: 'APPLIED', attempts: 1, appliedAt: new Date() }, update: { type: mutation.type, payload: { ...mutation.payload, serverId } as Prisma.InputJsonValue, status: 'APPLIED', attempts: { increment: 1 }, lastError: null, appliedAt: new Date() } });
            results.push({ clientId: mutation.clientId, status: 'APPLIED', serverId });
        } catch (error) {
            if (error instanceof OfflineConflictError) {
                await prisma.offlineMutation.upsert({ where: { userId_clientId: { userId: auth.user.id, clientId: mutation.clientId } }, create: { userId: auth.user.id, clientId: mutation.clientId, type: mutation.type, payload: mutation.payload as Prisma.InputJsonValue, status: 'CONFLICT', attempts: 1, lastError: error.message }, update: { attempts: { increment: 1 }, status: 'CONFLICT', lastError: error.message } });
                results.push({ clientId: mutation.clientId, status: 'CONFLICT', message: error.message, conflict: error.details });
                continue;
            }
            await prisma.offlineMutation.upsert({ where: { userId_clientId: { userId: auth.user.id, clientId: mutation.clientId } }, create: { userId: auth.user.id, clientId: mutation.clientId, type: mutation.type, payload: mutation.payload as Prisma.InputJsonValue, status: 'FAILED', attempts: 1, lastError: error instanceof Error ? error.message : 'Mutation failed' }, update: { attempts: { increment: 1 }, status: 'FAILED', lastError: error instanceof Error ? error.message : 'Mutation failed' } });
            results.push({ clientId: mutation.clientId, status: 'ERROR', message: error instanceof Error ? error.message : 'Mutation failed' });
        }
    }
    return Response.json({ results });
}

export async function listOfflineMutationFailuresHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const mutations = await prisma.offlineMutation.findMany({ where: { userId: auth.user.id, status: { in: ['FAILED', 'CONFLICT'] } }, orderBy: { updatedAt: 'desc' }, take: 50, select: { clientId: true, type: true, status: true, attempts: true, lastError: true, payload: true, updatedAt: true } });
    return Response.json({ mutations });
}
