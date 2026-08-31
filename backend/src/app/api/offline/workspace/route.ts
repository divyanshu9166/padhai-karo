import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;

type Cursor = { id: string; timestamp: Date };

function parseCursor(raw: string | null, name: string): Cursor | undefined {
    if (!raw) return undefined;
    const separator = raw.indexOf('|');
    if (separator <= 0) throw new Error(`${name} is invalid.`);
    const id = raw.slice(0, separator);
    const timestamp = new Date(raw.slice(separator + 1));
    if (!id || Number.isNaN(timestamp.getTime())) throw new Error(`${name} is invalid.`);
    return { id, timestamp };
}

function encodeCursor(id: string, timestamp: Date): string {
    return `${id}|${timestamp.toISOString()}`;
}

function page<T extends { id: string; updatedAt?: Date; startTime?: Date; startDate?: Date }>(items: T[], limit: number, timestamp: (item: T) => Date): { items: T[]; nextCursor: string | null } {
    const hasMore = items.length > limit;
    const result = hasMore ? items.slice(0, limit) : items;
    const last = result[result.length - 1];
    return { items: result, nextCursor: last && hasMore ? encodeCursor(last.id, timestamp(last)) : null };
}

/**
 * Download the authenticated user's structured study workspace in one request. This is a
 * metadata/text bundle; binary PDFs remain available through their authenticated file routes
 * and are downloaded separately by the mobile library so one oversized JSON response cannot
 * corrupt the rest of the offline cache.
 */
export const GET = withAuth(async (request, auth) => {
    const url = new URL(request.url);
    const from = new Date(url.searchParams.get('from') || Date.now());
    const start = Number.isNaN(from.getTime()) ? new Date() : from;
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
    const requestedLimit = Number(url.searchParams.get('limit') || DEFAULT_PAGE_SIZE);
    const limit = Number.isFinite(requestedLimit) ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit))) : DEFAULT_PAGE_SIZE;
    let blockCursor: Cursor | undefined;
    let resourceCursor: Cursor | undefined;
    let pdfCursor: Cursor | undefined;
    let annotationCursor: Cursor | undefined;
    let voiceCursor: Cursor | undefined;
    let eventCursor: Cursor | undefined;
    try {
        blockCursor = parseCursor(url.searchParams.get('blockCursor'), 'blockCursor');
        resourceCursor = parseCursor(url.searchParams.get('resourceCursor'), 'resourceCursor');
        pdfCursor = parseCursor(url.searchParams.get('pdfCursor'), 'pdfCursor');
        annotationCursor = parseCursor(url.searchParams.get('annotationCursor'), 'annotationCursor');
        voiceCursor = parseCursor(url.searchParams.get('voiceCursor'), 'voiceCursor');
        eventCursor = parseCursor(url.searchParams.get('eventCursor'), 'eventCursor');
    } catch (error) {
        return Response.json({ error: { code: 'VALIDATION_ERROR', message: error instanceof Error ? error.message : 'Invalid offline workspace cursor.' } }, { status: 400 });
    }
    const [rawBlocks, rawResources, rawPdfs, rawAnnotations, rawVoiceNotes, rawEvents, sleepSchedule] = await Promise.all([
        prisma.studyBlock.findMany({ where: { userId: auth.user.id, startTime: { gte: start, lt: end }, ...(blockCursor ? { OR: [{ startTime: { gt: blockCursor.timestamp } }, { startTime: blockCursor.timestamp, id: { gt: blockCursor.id } }] } : {}) }, orderBy: [{ startTime: 'asc' }, { id: 'asc' }], take: limit + 1, select: { id: true, subjectId: true, chapterId: true, startTime: true, durationMin: true, isBuffer: true, energyLevel: true, scheduledOutsidePeak: true, sessionType: true, revisionNumber: true, revisionLabel: true } }),
        prisma.studyResource.findMany({ where: { userId: auth.user.id, ...(resourceCursor ? { OR: [{ updatedAt: { lt: resourceCursor.timestamp } }, { updatedAt: resourceCursor.timestamp, id: { lt: resourceCursor.id } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1 }),
        prisma.pdfDocument.findMany({ where: { userId: auth.user.id, ...(pdfCursor ? { OR: [{ updatedAt: { lt: pdfCursor.timestamp } }, { updatedAt: pdfCursor.timestamp, id: { lt: pdfCursor.id } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1, select: { id: true, title: true, fileUrl: true, fileName: true, fileMimeType: true, fileChecksum: true, extractedText: true, pageText: true, tags: true, pageCount: true, updatedAt: true } }),
        prisma.pdfAnnotation.findMany({ where: { userId: auth.user.id, ...(annotationCursor ? { OR: [{ updatedAt: { lt: annotationCursor.timestamp } }, { updatedAt: annotationCursor.timestamp, id: { lt: annotationCursor.id } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1 }),
        prisma.voiceNote.findMany({ where: { userId: auth.user.id, audioData: { not: null }, ...(voiceCursor ? { OR: [{ updatedAt: { lt: voiceCursor.timestamp } }, { updatedAt: voiceCursor.timestamp, id: { lt: voiceCursor.id } }] } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1, select: { id: true, title: true, audioUri: true, audioFileName: true, audioMimeType: true, durationSec: true, transcription: true, tags: true, updatedAt: true } }),
        prisma.calendarEvent.findMany({ where: { userId: auth.user.id, endDate: { gte: start }, startDate: { lt: end }, ...(eventCursor ? { OR: [{ startDate: { gt: eventCursor.timestamp } }, { startDate: eventCursor.timestamp, id: { gt: eventCursor.id } }] } : {}) }, orderBy: [{ startDate: 'asc' }, { id: 'asc' }], take: limit + 1 }),
        prisma.sleepSchedule.findUnique({ where: { userId: auth.user.id } }),
    ]);
    const blocks = page(rawBlocks, limit, (item) => item.startTime);
    const resources = page(rawResources, limit, (item) => item.updatedAt);
    const pdfs = page(rawPdfs, limit, (item) => item.updatedAt);
    const annotations = page(rawAnnotations, limit, (item) => item.updatedAt);
    const voiceNotes = page(rawVoiceNotes, limit, (item) => item.updatedAt);
    const events = page(rawEvents, limit, (item) => item.startDate);
    return Response.json({ generatedAt: new Date().toISOString(), range: { from: start.toISOString(), to: end.toISOString() }, blocks: blocks.items, resources: resources.items, pdfs: pdfs.items, annotations: annotations.items, voiceNotes: voiceNotes.items, events: events.items, sleepSchedule, nextCursors: { block: blocks.nextCursor, resource: resources.nextCursor, pdf: pdfs.nextCursor, annotation: annotations.nextCursor, voice: voiceNotes.nextCursor, event: events.nextCursor } });
});
