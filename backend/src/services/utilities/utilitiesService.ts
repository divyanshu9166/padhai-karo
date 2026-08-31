import { createHash } from 'node:crypto';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { transcribeAudio, transcriptionProviderConfigured } from '@/services/ai/liveProvider';
import { sendUserPushNotification } from '@/services/notifications';
import { broadcastCommunityMessage } from '@/realtime/communitySocket';
import { CommunityContentStatus, Prisma } from '@prisma/client';
import { requireModerationKey } from '@/lib/operatorAuth';

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 30) : []; }

export async function listResourcesHandler(request: Request, auth: AuthContext): Promise<Response> {
    const subjectId = new URL(request.url).searchParams.get('subjectId');
    const resources = await prisma.studyResource.findMany({ where: { userId: auth.user.id, ...(subjectId ? { subjectId } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
    return Response.json({ resources });
}

export async function createResourceHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const title = text(input.title);
    if (!title) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A resource title is required.');
    const resource = await prisma.studyResource.create({ data: { userId: auth.user.id, title, subjectId: text(input.subjectId) || undefined, chapterId: text(input.chapterId) || undefined, url: text(input.url) || undefined, type: text(input.type) || 'LINK', tags: stringList(input.tags) } });
    return Response.json({ resource }, { status: 201 });
}

export interface UtilityRouteContext { params: { id: string } | Promise<{ id: string }> }

export async function updateResourceHandler(request: Request, auth: AuthContext, context: UtilityRouteContext): Promise<Response> {
    const params = await context.params;
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const existing = await prisma.studyResource.findFirst({ where: { id: params.id, userId: auth.user.id } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Resource not found.');
    const input = body as Record<string, unknown>;
    const resource = await prisma.studyResource.update({ where: { id: existing.id }, data: { title: input.title === undefined ? undefined : text(input.title), url: input.url === undefined ? undefined : text(input.url) || null, tags: input.tags === undefined ? undefined : stringList(input.tags), completed: input.completed === undefined ? undefined : input.completed === true } });
    return Response.json({ resource });
}

export async function deleteResourceHandler(_request: Request, auth: AuthContext, context: UtilityRouteContext): Promise<Response> {
    const params = await context.params;
    const existing = await prisma.studyResource.findFirst({ where: { id: params.id, userId: auth.user.id }, select: { id: true } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Resource not found.');
    await prisma.studyResource.delete({ where: { id: existing.id } });
    return new Response(null, { status: 204 });
}

export async function listPdfDocumentsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const query = new URL(_request.url).searchParams.get('q')?.trim();
    const documents = await prisma.pdfDocument.findMany({ where: { userId: auth.user.id, ...(query ? { OR: [{ title: { contains: query, mode: 'insensitive' } }, { extractedText: { contains: query, mode: 'insensitive' } }] } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, userId: true, title: true, fileUrl: true, fileName: true, fileMimeType: true, fileChecksum: true, extractedText: true, pageText: true, tags: true, pageCount: true, createdAt: true, updatedAt: true } });
    return Response.json({ documents });
}

export async function createPdfDocumentHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const title = text(input.title);
    if (!title) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A document title is required.');
    const document = await prisma.pdfDocument.create({ data: { userId: auth.user.id, title, fileUrl: text(input.fileUrl) || undefined, extractedText: text(input.extractedText) || undefined, tags: stringList(input.tags), pageCount: typeof input.pageCount === 'number' ? input.pageCount : undefined } });
    return Response.json({ document }, { status: 201 });
}

/** Upload a PDF, extract searchable text server-side, and persist the reader metadata. */
export async function uploadPdfDocumentHandler(request: Request, auth: AuthContext): Promise<Response> {
    let form: FormData;
    try { form = await request.formData(); } catch { return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A multipart PDF upload is required.'); }
    const file = form.get('file');
    if (!(file instanceof File) || file.type !== 'application/pdf') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Only application/pdf uploads are supported.');
    if (file.size > 25 * 1024 * 1024) return errorResponse(413, ErrorCode.VALIDATION_ERROR, 'PDFs must be 25 MB or smaller.');
    const title = text(form.get('title')) || file.name.replace(/\.pdf$/i, '') || 'Study PDF';
    const tags = stringList(form.get('tags') ? String(form.get('tags')).split(',') : []);
    try {
        // Lazy-load because pdf-parse ships an optional test fixture that should never be
        // evaluated while Next is collecting unrelated API route data during a build.
        const pdfParse = (await import('pdf-parse')).default;
        const bytes = Buffer.from(await file.arrayBuffer());
        const checksum = createHash('sha256').update(bytes).digest('hex');
        const existing = await prisma.pdfDocument.findFirst({ where: { userId: auth.user.id, fileChecksum: checksum }, select: { id: true, userId: true, title: true, fileUrl: true, fileName: true, fileMimeType: true, fileChecksum: true, extractedText: true, pageText: true, tags: true, pageCount: true, createdAt: true, updatedAt: true } });
        if (existing) return Response.json({ document: existing, extractedText: existing.extractedText, searchable: Boolean(existing.extractedText), pages: existing.pageCount ?? 0, duplicate: true }, { status: 200 });
        const pages: string[] = [];
        const parsed = await pdfParse(bytes, { pagerender: async (pageData: { getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }) => { const content = await pageData.getTextContent(); const page = content.items.map((item) => item.str ?? '').join(' ').replace(/\s+/g, ' ').trim(); pages.push(page); return page + '\f'; } });
        const pageText = pages.length > 0 ? pages : parsed.text.split('\f').map((page) => page.trim()).filter(Boolean);
        const extractedText = parsed.text.slice(0, 5_000_000);
        const document = await prisma.pdfDocument.create({ data: { userId: auth.user.id, title, fileName: file.name, fileMimeType: 'application/pdf', fileData: bytes, fileChecksum: checksum, extractedText, pageText: pageText.slice(0, 2000), pageCount: parsed.numpages, fileUrl: `/api/pdf-documents/file?checksum=${checksum}`, tags: [...new Set([...tags, 'uploaded', 'text-extracted'])] }, select: { id: true, userId: true, title: true, fileUrl: true, fileName: true, fileMimeType: true, fileChecksum: true, extractedText: true, pageText: true, tags: true, pageCount: true, createdAt: true, updatedAt: true } });
        return Response.json({ document, extractedText: document.extractedText, searchable: Boolean(extractedText), pages: pageText.length }, { status: 201 });
    } catch { return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'The PDF could not be parsed. It may be encrypted, damaged, or image-only.'); }
}

export async function getPdfFileHandler(_request: Request, auth: AuthContext, context: UtilityRouteContext): Promise<Response> {
    const { id } = await context.params;
    const document = await prisma.pdfDocument.findFirst({ where: { id, userId: auth.user.id }, select: { fileData: true, fileMimeType: true, fileName: true } });
    if (!document?.fileData) return errorResponse(404, ErrorCode.NOT_FOUND, 'PDF file is not available.');
    return new Response(new Uint8Array(document.fileData), { headers: { 'Content-Type': document.fileMimeType || 'application/pdf', 'Content-Length': String(document.fileData.length), 'Content-Disposition': `inline; filename="${(document.fileName || 'study.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'Cache-Control': 'private, max-age=3600' } });
}

export async function getPdfFileByChecksumHandler(request: Request, auth: AuthContext): Promise<Response> {
    const checksum = new URL(request.url).searchParams.get('checksum')?.trim();
    if (!checksum) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A PDF checksum is required.');
    const document = await prisma.pdfDocument.findFirst({ where: { userId: auth.user.id, fileChecksum: checksum }, select: { fileData: true, fileMimeType: true, fileName: true } });
    if (!document?.fileData) return errorResponse(404, ErrorCode.NOT_FOUND, 'PDF file is not available.');
    return new Response(new Uint8Array(document.fileData), { headers: { 'Content-Type': document.fileMimeType || 'application/pdf', 'Content-Length': String(document.fileData.length), 'Content-Disposition': `inline; filename="${(document.fileName || 'study.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'Cache-Control': 'private, max-age=3600' } });
}

export async function listVoiceNotesHandler(request: Request, auth: AuthContext): Promise<Response> {
    const query = new URL(request.url).searchParams.get('q')?.trim();
    const notes = await prisma.voiceNote.findMany({ where: { userId: auth.user.id, ...(query ? { OR: [{ title: { contains: query, mode: 'insensitive' } }, { searchText: { contains: query, mode: 'insensitive' } }, { tags: { has: query.toLowerCase() } }] } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
    return Response.json({ notes });
}

export async function createVoiceNoteHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const title = text(input.title);
    if (!title) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A voice-note title is required.');
    const transcription = text(input.transcription);
    const chapterCandidates = transcription ? await prisma.chapter.findMany({ where: { userId: auth.user.id }, select: { id: true, subjectId: true, name: true }, take: 300 }) : [];
    const transcriptWords = new Set(transcription.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const chapter = chapterCandidates.map((item) => {
        const chapterWords = item.name.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length >= 4) ?? [];
        const overlap = chapterWords.filter((word) => transcriptWords.has(word)).length;
        return { item, overlap, required: chapterWords.length <= 1 ? 1 : 2 };
    }).filter((candidate) => candidate.overlap >= candidate.required).sort((a, b) => b.overlap - a.overlap || b.item.name.length - a.item.name.length)[0]?.item ?? null;
    const tags = stringList(input.tags).map((tag) => tag.toLowerCase());
    if (chapter && !tags.includes(chapter.name.toLowerCase())) tags.push(chapter.name.toLowerCase());
    const note = await prisma.voiceNote.create({ data: { userId: auth.user.id, title, audioUri: text(input.audioUri) || undefined, transcription: transcription || undefined, durationSec: typeof input.durationSec === 'number' ? input.durationSec : undefined, subjectId: text(input.subjectId) || chapter?.subjectId, chapterId: chapter?.id, tags, searchText: `${title} ${transcription}`.trim() || undefined } });
    return Response.json({ note }, { status: 201 });
}

export async function uploadVoiceNoteHandler(request: Request, auth: AuthContext): Promise<Response> {
    let form: FormData;
    try { form = await request.formData(); } catch { return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A multipart audio upload is required.'); }
    const file = form.get('file');
    if (!(file instanceof File) || !file.type.startsWith('audio/')) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'An audio file is required.');
    if (file.size > 25 * 1024 * 1024) return errorResponse(413, ErrorCode.VALIDATION_ERROR, 'Audio files must be 25 MB or smaller.');
    const title = text(form.get('title')) || file.name.replace(/\.[^.]+$/, '') || 'Voice note';
    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const note = await prisma.voiceNote.create({ data: { userId: auth.user.id, title, audioFileName: file.name, audioMimeType: file.type || 'audio/mp4', audioData: bytes, audioUri: `/api/voice-notes/${encodeURIComponent(checksum)}/file`, durationSec: Number(form.get('durationSec')) || undefined, tags: stringList(form.get('tags') ? String(form.get('tags')).split(',') : ['voice-note']), searchText: title } });
    return Response.json({ note, transcription: null, transcriptionAvailable: transcriptionProviderConfigured() }, { status: 201 });
}

export async function getVoiceFileHandler(_request: Request, auth: AuthContext, context: UtilityRouteContext): Promise<Response> {
    const { id } = await context.params;
    const note = await prisma.voiceNote.findFirst({ where: { userId: auth.user.id, OR: [{ id }, { audioUri: { contains: id } }] }, select: { audioData: true, audioMimeType: true, audioFileName: true } });
    if (!note?.audioData) return errorResponse(404, ErrorCode.NOT_FOUND, 'Audio file is not available.');
    return new Response(new Uint8Array(note.audioData), { headers: { 'Content-Type': note.audioMimeType || 'audio/mp4', 'Content-Length': String(note.audioData.length), 'Content-Disposition': `inline; filename="${(note.audioFileName || 'voice-note.m4a').replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'Cache-Control': 'private, max-age=3600' } });
}

export async function transcribeVoiceNoteHandler(_request: Request, auth: AuthContext, context: UtilityRouteContext): Promise<Response> {
    const { id } = await context.params;
    const note = await prisma.voiceNote.findFirst({ where: { id, userId: auth.user.id }, select: { id: true, audioData: true, audioMimeType: true, title: true } });
    if (!note) return errorResponse(404, ErrorCode.NOT_FOUND, 'Voice note not found.');
    if (!note.audioData) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'This voice note has no stored audio.');
    try {
        const transcription = await transcribeAudio('data:' + (note.audioMimeType || 'audio/mp4') + ';base64,' + Buffer.from(note.audioData).toString('base64'), note.audioMimeType || 'audio/mp4');
        const updated = await prisma.voiceNote.update({ where: { id: note.id }, data: { transcription, searchText: `${note.title} ${transcription}`.trim() } });
        return Response.json({ note: updated });
    } catch { return errorResponse(503, ErrorCode.AI_PROVIDER_UNAVAILABLE, 'Voice transcription provider is not configured or unavailable.'); }
}

export async function listCommunityPostsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true } });
    const posts = await prisma.communityPost.findMany({ where: { moderationStatus: CommunityContentStatus.VISIBLE, ...(profile?.examProgram ? { OR: [{ examProgram: profile.examProgram }, { examProgram: null }] } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, examProgram: true, title: true, body: true, tags: true, anonymous: true, createdAt: true } });
    return Response.json({ posts: posts.map((post) => ({ ...post, authorLabel: post.anonymous ? 'Anonymous aspirant' : 'Community member' })) });
}

export async function createCommunityPostHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const title = text(input.title); const content = text(input.body);
    if (!title || !content) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'title and body are required.');
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true } });
    const post = await prisma.communityPost.create({ data: { userId: auth.user.id, examProgram: profile?.examProgram ?? undefined, title, body: content, tags: stringList(input.tags), anonymous: input.anonymous !== false } });
    return Response.json({ post: { ...post, authorLabel: post.anonymous ? 'Anonymous aspirant' : 'Community member' } }, { status: 201 });
}

export async function createCommunityReportHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const postId = text(input.postId) || undefined; const messageId = text(input.messageId) || undefined; const reason = text(input.reason);
    if ((!postId && !messageId) || (postId && messageId) || !reason || reason.length > 500) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Report one post or message with a reason up to 500 characters.');
    if (postId && !(await prisma.communityPost.findUnique({ where: { id: postId }, select: { id: true } }))) return errorResponse(404, ErrorCode.NOT_FOUND, 'Post not found.');
    if (messageId && !(await prisma.communityMessage.findUnique({ where: { id: messageId }, select: { id: true } }))) return errorResponse(404, ErrorCode.NOT_FOUND, 'Message not found.');
    const report = await prisma.communityReport.create({ data: { reporterId: auth.user.id, postId, messageId, reason } });
    return Response.json({ report }, { status: 201 });
}

/** Operator queue for reviewing reports without exposing reporter identity to community users. */
export async function listCommunityReportsAdminHandler(request: Request): Promise<Response> {
    const denied = requireModerationKey(request);
    if (denied) return denied;
    const status = new URL(request.url).searchParams.get('status')?.trim().toUpperCase();
    const reports = await prisma.communityReport.findMany({
        where: status && ['OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED'].includes(status) ? { status } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
            id: true, reporterId: true, postId: true, messageId: true, reason: true, status: true, createdAt: true, updatedAt: true,
            post: { select: { id: true, title: true, body: true, moderationStatus: true } },
            message: { select: { id: true, senderId: true, recipientId: true, body: true, moderationStatus: true } },
        },
    });
    return Response.json({ reports });
}

/** Resolve a report and optionally hide/show its target content. */
export async function updateCommunityReportAdminHandler(request: Request): Promise<Response> {
    const denied = requireModerationKey(request);
    if (denied) return denied;
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const id = text(input.id);
    const action = text(input.action).toUpperCase();
    if (!id || !['HIDE', 'SHOW', 'REVIEW', 'DISMISS'].includes(action)) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'id and action (HIDE, SHOW, REVIEW or DISMISS) are required.');
    const report = await prisma.communityReport.findUnique({ where: { id }, select: { id: true, postId: true, messageId: true } });
    if (!report) return errorResponse(404, ErrorCode.NOT_FOUND, 'Community report not found.');
    const reportStatus = action === 'HIDE' ? 'ACTIONED' : action === 'DISMISS' ? 'DISMISSED' : 'REVIEWED';
    const contentStatus = action === 'HIDE' ? CommunityContentStatus.HIDDEN : action === 'SHOW' ? CommunityContentStatus.VISIBLE : undefined;
    const operations: Array<Prisma.PrismaPromise<unknown>> = [prisma.communityReport.update({ where: { id }, data: { status: reportStatus } })];
    if (contentStatus && report.postId) operations.push(prisma.communityPost.update({ where: { id: report.postId }, data: { moderationStatus: contentStatus } }));
    if (contentStatus && report.messageId) operations.push(prisma.communityMessage.update({ where: { id: report.messageId }, data: { moderationStatus: contentStatus } }));
    const [updated] = await prisma.$transaction(operations);
    return Response.json({ report: updated, action });
}

export async function listBuddiesHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const [sent, received] = await Promise.all([
        prisma.studyBuddy.findMany({ where: { requesterId: auth.user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, recipientId: true, status: true, createdAt: true } }),
        prisma.studyBuddy.findMany({ where: { recipientId: auth.user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, requesterId: true, status: true, createdAt: true } }),
    ]);
    return Response.json({ sent, received });
}

export async function createBuddyRequestHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const recipientId = text((body as Record<string, unknown>).recipientId);
    if (!recipientId || recipientId === auth.user.id) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A different recipientId is required.');
    const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!recipient) return errorResponse(404, ErrorCode.NOT_FOUND, 'Aspirant not found.');
    const buddy = await prisma.studyBuddy.upsert({ where: { requesterId_recipientId: { requesterId: auth.user.id, recipientId } }, create: { requesterId: auth.user.id, recipientId }, update: { status: 'PENDING' } });
    void sendUserPushNotification(recipientId, 'New study buddy request', 'An aspirant wants to study with you.', { route: 'Community', buddyId: buddy.id }).catch(() => undefined);
    return Response.json({ buddy }, { status: 201 });
}

export async function updateBuddyHandler(request: Request, auth: AuthContext, context: UtilityRouteContext): Promise<Response> {
    const { id } = await context.params;
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    const status: string = body && typeof body === 'object' && typeof (body as Record<string, unknown>).status === 'string' ? String((body as Record<string, unknown>).status) : '';
    if (!['ACCEPTED', 'DECLINED', 'BLOCKED'].includes(status)) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'status must be ACCEPTED, DECLINED or BLOCKED.');
    const buddy = await prisma.studyBuddy.findFirst({ where: { id, recipientId: auth.user.id } });
    if (!buddy) return errorResponse(404, ErrorCode.NOT_FOUND, 'Buddy request not found.');
    const updated = await prisma.studyBuddy.update({ where: { id }, data: { status } });
    return Response.json({ buddy: updated });
}

async function acceptedBuddy(userId: string, otherUserId: string): Promise<boolean> {
    const relation = await prisma.studyBuddy.findFirst({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId, recipientId: otherUserId }, { requesterId: otherUserId, recipientId: userId }] }, select: { id: true } });
    return Boolean(relation);
}

export async function listBuddyMatchesHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true } });
    const relations = await prisma.studyBuddy.findMany({ where: { OR: [{ requesterId: auth.user.id }, { recipientId: auth.user.id }] }, select: { requesterId: true, recipientId: true } });
    const excluded = new Set(relations.flatMap((relation) => [relation.requesterId, relation.recipientId]));
    const candidates = await prisma.user.findMany({ where: { id: { not: auth.user.id }, profile: profile?.examProgram ? { examProgram: profile.examProgram } : undefined }, select: { id: true, profile: { select: { examProgram: true, examStage: true } } }, take: 30 });
    return Response.json({ matches: candidates.filter((candidate) => !excluded.has(candidate.id)).map((candidate) => ({ userId: candidate.id, examProgram: candidate.profile?.examProgram ?? null, examStage: candidate.profile?.examStage ?? null, matchScore: candidate.profile?.examStage && candidate.profile.examStage === profile?.examStage ? 100 : 70, reason: candidate.profile?.examStage === profile?.examStage ? 'Same exam stage' : 'Same exam community' })) });
}

export async function listCommunityMessagesHandler(request: Request, auth: AuthContext): Promise<Response> {
    const url = new URL(request.url); const otherUserId = text(url.searchParams.get('with')); const sinceRaw = url.searchParams.get('since'); const since = sinceRaw ? new Date(sinceRaw) : null;
    if (!otherUserId || !(await acceptedBuddy(auth.user.id, otherUserId))) return errorResponse(403, ErrorCode.FORBIDDEN, 'Messaging is available after a buddy request is accepted.');
    const after = since && !Number.isNaN(since.getTime()) ? { createdAt: { gt: since } } : {};
    const messages = await prisma.communityMessage.findMany({ where: { moderationStatus: CommunityContentStatus.VISIBLE, ...after, OR: [{ senderId: auth.user.id, recipientId: otherUserId }, { senderId: otherUserId, recipientId: auth.user.id }] }, orderBy: { createdAt: 'asc' }, take: 200 });
    await prisma.communityMessage.updateMany({ where: { senderId: otherUserId, recipientId: auth.user.id, readAt: null }, data: { readAt: new Date() } });
    return Response.json({ messages });
}

export async function createCommunityMessageHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>; const recipientId = text(input.recipientId); const content = text(input.body);
    if (!recipientId || !content || content.length > 4000) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'recipientId and a message up to 4000 characters are required.');
    if (!(await acceptedBuddy(auth.user.id, recipientId))) return errorResponse(403, ErrorCode.FORBIDDEN, 'Messaging is available after a buddy request is accepted.');
    const message = await prisma.communityMessage.create({ data: { senderId: auth.user.id, recipientId, body: content } });
    broadcastCommunityMessage(message);
    void sendUserPushNotification(recipientId, 'New study message', content.slice(0, 120), { route: 'Community', with: auth.user.id }).catch(() => undefined);
    return Response.json({ message }, { status: 201 });
}

export async function shareDashboardHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const recipientId = text(input.recipientId);
    if (!recipientId || !(await acceptedBuddy(auth.user.id, recipientId))) return errorResponse(403, ErrorCode.FORBIDDEN, 'Share a dashboard only with an accepted buddy.');
    const share = await prisma.buddyDashboardShare.upsert({ where: { ownerId_recipientId: { ownerId: auth.user.id, recipientId } }, create: { ownerId: auth.user.id, recipientId, enabled: input.enabled !== false }, update: { enabled: input.enabled !== false } });
    return Response.json({ share });
}

export async function getSharedDashboardHandler(_request: Request, auth: AuthContext, context: UtilityRouteContext): Promise<Response> {
    const { id: otherUserId } = await context.params;
    if (!(await acceptedBuddy(auth.user.id, otherUserId))) return errorResponse(403, ErrorCode.FORBIDDEN, 'This dashboard is only available to accepted buddies.');
    const share = await prisma.buddyDashboardShare.findFirst({ where: { ownerId: otherUserId, recipientId: auth.user.id, enabled: true }, select: { id: true } });
    if (!share) return errorResponse(403, ErrorCode.FORBIDDEN, 'This buddy has not shared their dashboard.');
    const since = new Date(); since.setUTCDate(since.getUTCDate() - 7);
    const [focus, audits, blocks] = await Promise.all([
        prisma.focusSession.findMany({ where: { userId: otherUserId, startTime: { gte: since } }, select: { focusedDurationMin: true, startTime: true, sessionType: true }, orderBy: { startTime: 'desc' }, take: 100 }),
        prisma.dailyTimeAudit.findMany({ where: { userId: otherUserId, date: { gte: since } }, select: { date: true, plannedMin: true, actualMin: true }, orderBy: { date: 'desc' }, take: 14 }),
        prisma.studyBlock.findMany({ where: { userId: otherUserId, startTime: { gte: new Date() } }, select: { startTime: true, durationMin: true, sessionType: true }, orderBy: { startTime: 'asc' }, take: 10 }),
    ]);
    return Response.json({ dashboard: { focusMinutes: focus.reduce((sum, item) => sum + item.focusedDurationMin, 0), focusSessions: focus.length, audits, upcomingBlocks: blocks } });
}
