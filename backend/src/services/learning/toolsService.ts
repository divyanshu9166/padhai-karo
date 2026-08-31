import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { liveProviderConfigured, summarizeWithGemini } from '@/services/ai/liveProvider';

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function list(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(0, 50) : []; }
function json(value: unknown): Prisma.InputJsonValue { return value && typeof value === 'object' ? value as Prisma.InputJsonValue : []; }

async function body(request: Request): Promise<Record<string, unknown> | null> {
    try { const value = await request.json(); return value && typeof value === 'object' ? value as Record<string, unknown> : null; } catch { return null; }
}

export async function listFormulaItemsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const items = await prisma.formulaItem.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    return Response.json({ items });
}

export async function createRecallDrillAttemptHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request);
    if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const itemCount = typeof input.itemCount === 'number' ? Math.floor(input.itemCount) : NaN;
    const durationSec = typeof input.durationSec === 'number' ? Math.floor(input.durationSec) : NaN;
    const correct = typeof input.correct === 'number' ? Math.floor(input.correct) : NaN;
    const revealed = typeof input.revealed === 'number' ? Math.floor(input.revealed) : NaN;
    if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 100 || !Number.isInteger(durationSec) || durationSec < 1 || !Number.isInteger(correct) || correct < 0 || !Number.isInteger(revealed) || revealed < 0 || correct > itemCount || revealed > itemCount) {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Drill metrics are outside their valid ranges.');
    }
    const attempt = await prisma.recallDrillAttempt.create({ data: { userId: auth.user.id, sourceType: text(input.sourceType) || 'REVISION', itemCount, durationSec, correct, revealed } });
    return Response.json({ attempt, accuracyPercent: Math.round(correct / itemCount * 100) }, { status: 201 });
}

export async function createFormulaItemHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request); if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const title = text(input.title); const expression = text(input.expression);
    if (!title || !expression) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'title and expression are required.');
    const item = await prisma.formulaItem.create({ data: { userId: auth.user.id, title, expression, explanation: text(input.explanation) || undefined, subjectId: text(input.subjectId) || undefined, chapterId: text(input.chapterId) || undefined, tags: list(input.tags) } });
    return Response.json({ item }, { status: 201 });
}

export async function listConceptMapsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    return Response.json({ maps: await prisma.conceptMap.findMany({ where: { userId: auth.user.id }, orderBy: { updatedAt: 'desc' }, take: 100 }) });
}

export async function createConceptMapHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request); if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const title = text(input.title); if (!title) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'title is required.');
    const map = await prisma.conceptMap.create({ data: { userId: auth.user.id, title, nodes: json(input.nodes), edges: json(input.edges) } });
    return Response.json({ map }, { status: 201 });
}

export async function listCapsulesHandler(request: Request, auth: AuthContext): Promise<Response> {
    const chapterId = new URL(request.url).searchParams.get('chapterId');
    return Response.json({ capsules: await prisma.quickRevisionCapsule.findMany({ where: { userId: auth.user.id, ...(chapterId ? { chapterId } : {}) }, orderBy: { updatedAt: 'desc' }, take: 100 }) });
}

export async function createCapsuleHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request); if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const title = text(input.title); const points = Array.isArray(input.points) ? input.points.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(0, 30) : [];
    if (!title || points.length === 0) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'title and at least one point are required.');
    const capsule = await prisma.$transaction(async (tx) => {
        const created = await tx.quickRevisionCapsule.create({ data: { userId: auth.user.id, title, points: points as unknown as Prisma.InputJsonValue, chapterId: text(input.chapterId) || undefined, sourceNoteId: text(input.sourceNoteId) || undefined } });
        await tx.revisionCard.createMany({ data: points.map((point, index) => ({ userId: auth.user.id, title, prompt: `Recall point ${index + 1}: explain it without looking.`, answer: point, sourceType: 'CAPSULE', sourceId: created.id, chapterId: text(input.chapterId) || undefined, tags: ['capsule'], dueAt: new Date() })) });
        return created;
    });
    return Response.json({ capsule }, { status: 201 });
}

export async function generateChapterCapsuleHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request); const chapterId = text(input?.chapterId);
    if (!chapterId) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'chapterId is required.');
    const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, userId: auth.user.id }, select: { id: true, name: true, status: true, weightage: true, estimatedStudyHours: true, subject: { select: { name: true } } } });
    if (!chapter) return errorResponse(404, ErrorCode.NOT_FOUND, 'Chapter not found.');
    let points: string[] = [
        `${chapter.name}: explain the core idea in three sentences from memory.`,
        `Framework for ${chapter.subject.name}: list the main terms, causes, features or steps.`,
        `Application: connect ${chapter.name} to one current-affairs example or previous-year question.`,
        `Common trap: write one distinction, exception or misconception to avoid.`,
        `Exam response: produce a 5-point answer outline in the time available for this chapter.`,
    ];
    if (liveProviderConfigured()) {
        try {
            const generated = await summarizeWithGemini(`Create a factual UPSC/SSC quick-revision capsule for chapter "${chapter.name}" in subject "${chapter.subject.name}". Return 5 concise keyPoints covering definition, framework, examples, common traps and exam application. Do not invent specific statistics; mark uncertain items as prompts for the student.`);
            if (generated.keyPoints.length >= 3) points = generated.keyPoints.slice(0, 8);
        } catch {
            // The deterministic prompts above remain useful when the provider is unavailable.
        }
    }
    const capsule = await prisma.$transaction(async (tx) => {
        const created = await tx.quickRevisionCapsule.create({ data: { userId: auth.user.id, chapterId: chapter.id, title: chapter.name + ' quick revision', points: points as unknown as Prisma.InputJsonValue } });
        await tx.revisionCard.createMany({ data: points.map((point, index) => ({ userId: auth.user.id, title: chapter.name + ' quick revision', prompt: `Recall capsule point ${index + 1}: explain it without looking.`, answer: point, sourceType: 'CAPSULE', sourceId: created.id, chapterId: chapter.id, tags: ['chapter', chapter.subject.name], dueAt: new Date() })) });
        return created;
    });
    return Response.json({ capsule }, { status: 201 });
}

export async function listAnnotationsHandler(request: Request, auth: AuthContext): Promise<Response> {
    const documentId = new URL(request.url).searchParams.get('documentId');
    if (documentId) {
        const document = await prisma.pdfDocument.findFirst({ where: { id: documentId, userId: auth.user.id }, select: { id: true } });
        if (!document) return errorResponse(404, ErrorCode.NOT_FOUND, 'PDF document not found.');
    }
    return Response.json({ annotations: await prisma.pdfAnnotation.findMany({ where: { userId: auth.user.id, ...(documentId ? { documentId } : {}) }, orderBy: [{ documentId: 'asc' }, { page: 'asc' }, { createdAt: 'asc' }] }) });
}

export async function createAnnotationHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request); if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const documentId = text(input.documentId); const page = typeof input.page === 'number' ? Math.floor(input.page) : NaN;
    if (!documentId || !Number.isInteger(page) || page < 1) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'documentId and a positive page are required.');
    const document = await prisma.pdfDocument.findFirst({ where: { id: documentId, userId: auth.user.id }, select: { id: true } });
    if (!document) return errorResponse(404, ErrorCode.NOT_FOUND, 'PDF document not found.');
    const selectionStart = typeof input.selectionStart === 'number' && Number.isInteger(input.selectionStart) && input.selectionStart >= 0 ? input.selectionStart : undefined;
    const selectionEnd = typeof input.selectionEnd === 'number' && Number.isInteger(input.selectionEnd) && input.selectionEnd >= (selectionStart ?? 0) ? input.selectionEnd : undefined;
    const rect = input.rect && typeof input.rect === 'object' && !Array.isArray(input.rect) ? input.rect as Prisma.InputJsonValue : undefined;
    const annotation = await prisma.pdfAnnotation.create({ data: { userId: auth.user.id, documentId, page, type: text(input.type) || 'HIGHLIGHT', quote: text(input.quote) || undefined, note: text(input.note) || undefined, color: text(input.color) || '#facc15', selectionStart, selectionEnd, rect } });
    return Response.json({ annotation }, { status: 201 });
}

export async function updateAnnotationHandler(request: Request, auth: AuthContext, context: { params: { id: string } | Promise<{ id: string }> }): Promise<Response> {
    const { id } = await context.params;
    const input = await body(request); if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const existing = await prisma.pdfAnnotation.findFirst({ where: { id, userId: auth.user.id }, select: { id: true } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Annotation not found.');
    const page = input.page === undefined ? undefined : typeof input.page === 'number' && Number.isInteger(input.page) && input.page > 0 ? Math.floor(input.page) : null;
    if (page === null) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'page must be a positive integer.');
    const annotation = await prisma.pdfAnnotation.update({ where: { id }, data: { page, type: input.type === undefined ? undefined : text(input.type) || 'NOTE', quote: input.quote === undefined ? undefined : text(input.quote) || null, note: input.note === undefined ? undefined : text(input.note) || null, color: input.color === undefined ? undefined : text(input.color) || '#facc15', selectionStart: input.selectionStart === undefined ? undefined : typeof input.selectionStart === 'number' ? Math.max(0, Math.floor(input.selectionStart)) : null, selectionEnd: input.selectionEnd === undefined ? undefined : typeof input.selectionEnd === 'number' ? Math.max(0, Math.floor(input.selectionEnd)) : null, rect: input.rect === undefined ? undefined : input.rect && typeof input.rect === 'object' && !Array.isArray(input.rect) ? input.rect as Prisma.InputJsonValue : Prisma.JsonNull } });
    return Response.json({ annotation });
}

export async function deleteAnnotationHandler(_request: Request, auth: AuthContext, context: { params: { id: string } | Promise<{ id: string }> }): Promise<Response> {
    const { id } = await context.params;
    const existing = await prisma.pdfAnnotation.findFirst({ where: { id, userId: auth.user.id }, select: { id: true } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Annotation not found.');
    await prisma.pdfAnnotation.delete({ where: { id } });
    return new Response(null, { status: 204 });
}

export async function listChecklistHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const existing = await prisma.examChecklistItem.findMany({ where: { userId: auth.user.id }, orderBy: [{ completed: 'asc' }, { dueAt: 'asc' }] });
    const exam = await prisma.examDate.findFirst({ where: { userId: auth.user.id, examDate: { gte: new Date() } }, orderBy: { examDate: 'asc' }, select: { id: true, examDate: true } });
    if (existing.length > 0) {
        if (exam) {
            const offsets = [14, 7, 3, 1, 1, 1];
            await Promise.all(existing.map((item, index) => item.examDateId === exam.id && item.dueAt ? Promise.resolve() : prisma.examChecklistItem.update({ where: { id: item.id }, data: { examDateId: exam.id, dueAt: new Date(exam.examDate.getTime() - offsets[index % offsets.length] * 86_400_000) } })));
        }
        return Response.json({ items: await prisma.examChecklistItem.findMany({ where: { userId: auth.user.id }, orderBy: [{ completed: 'asc' }, { dueAt: 'asc' }] }) });
    }
    const defaults = ['Download admit card / hall ticket', 'Verify valid photo ID', 'Pack transparent water bottle', 'Pack stationery and permitted items', 'Check route and reporting time', 'Protect sleep; only light revision on the eve'];
    const offsets = [14, 7, 3, 1, 1, 1];
    const created = await prisma.examChecklistItem.createManyAndReturn({ data: defaults.map((label, index) => ({ userId: auth.user.id, label, category: index < 2 ? 'DOCUMENTS' : index < 4 ? 'ITEMS' : 'PLAN', examDateId: exam?.id, dueAt: exam ? new Date(exam.examDate.getTime() - offsets[index] * 86_400_000) : undefined })) });
    return Response.json({ items: created });
}

export async function updateChecklistHandler(request: Request, auth: AuthContext, context: { params: { id: string } | Promise<{ id: string }> }): Promise<Response> {
    const { id } = await context.params; const input = await body(request);
    const item = await prisma.examChecklistItem.findFirst({ where: { id, userId: auth.user.id } });
    if (!item) return errorResponse(404, ErrorCode.NOT_FOUND, 'Checklist item not found.');
    const updated = await prisma.examChecklistItem.update({ where: { id }, data: { completed: input?.completed === true } });
    return Response.json({ item: updated });
}

export async function getMilestonesHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const defaults = [
        ['first-focus-session', 'Complete your first focus session', 1],
        ['ten-focus-sessions', 'Complete 10 focus sessions', 10],
        ['first-revision-cycle', 'Finish your first revision cycle', 1],
        ['syllabus-quarter', 'Complete 25% of your syllabus', 25],
    ] as const;
    for (const [key, label, targetValue] of defaults) await prisma.studyMilestone.upsert({ where: { userId_key: { userId: auth.user.id, key } }, create: { userId: auth.user.id, key, label, targetValue }, update: {} });
    const [milestones, focusCount, revisedCount, totalChapters, doneChapters] = await Promise.all([
        prisma.studyMilestone.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'asc' } }),
        prisma.focusSession.count({ where: { userId: auth.user.id } }),
        prisma.revisionCard.count({ where: { userId: auth.user.id, repetitions: { gte: 4 } } }),
        prisma.chapter.count({ where: { userId: auth.user.id } }),
        prisma.chapter.count({ where: { userId: auth.user.id, status: { in: ['DONE', 'REVISED'] } } }),
    ]);
    const values: Record<string, number> = { 'first-focus-session': focusCount > 0 ? 1 : 0, 'ten-focus-sessions': focusCount, 'first-revision-cycle': revisedCount > 0 ? 1 : 0, 'syllabus-quarter': totalChapters === 0 ? 0 : Math.round(doneChapters / totalChapters * 100) };
    const updated = await Promise.all(milestones.map((milestone) => prisma.studyMilestone.update({ where: { id: milestone.id }, data: { currentValue: values[milestone.key] ?? milestone.currentValue, achievedAt: (values[milestone.key] ?? 0) >= milestone.targetValue ? (milestone.achievedAt ?? new Date()) : null } })));
    return Response.json({ milestones: updated });
}

export async function listStrategiesHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const existing = await prisma.topperStrategy.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return Response.json({ strategies: existing.length > 0 ? existing : [
        { id: 'static-1', title: 'Build an error log', body: 'After every paper, record the mistake category and the corrective action.', tags: ['practice', 'reflection'], sourceName: 'PadhaiKaro' },
        { id: 'static-2', title: 'Protect revision time', body: 'Keep a daily short revision block even while covering new syllabus.', tags: ['revision', 'consistency'], sourceName: 'PadhaiKaro' },
    ] });
}

export async function createStrategyHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request); if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const title = text(input.title); const content = text(input.body);
    if (!title || !content) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'title and body are required.');
    const strategy = await prisma.topperStrategy.create({ data: { userId: auth.user.id, title, body: content, sourceName: text(input.sourceName) || undefined, sourceUrl: text(input.sourceUrl) || undefined, tags: list(input.tags) } });
    return Response.json({ strategy }, { status: 201 });
}

export async function listDoubtsHandler(request: Request, auth: AuthContext): Promise<Response> {
    const status = new URL(request.url).searchParams.get('status');
    return Response.json({ doubts: await prisma.doubtItem.findMany({ where: { userId: auth.user.id, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 }) });
}

export async function createDoubtHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request); if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const title = text(input.title); const question = text(input.question);
    if (!title || !question) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'title and question are required.');
    const doubt = await prisma.doubtItem.create({ data: { userId: auth.user.id, title, question, tags: list(input.tags), resourceUrls: list(input.resourceUrls) } });
    return Response.json({ doubt }, { status: 201 });
}

export async function updateDoubtHandler(request: Request, auth: AuthContext, context: { params: { id: string } | Promise<{ id: string }> }): Promise<Response> {
    const { id } = await context.params; const input = await body(request);
    const existing = await prisma.doubtItem.findFirst({ where: { id, userId: auth.user.id } });
    if (!existing) return errorResponse(404, ErrorCode.NOT_FOUND, 'Doubt not found.');
    const doubt = await prisma.doubtItem.update({ where: { id }, data: { status: text(input?.status) || existing.status, tags: input?.tags === undefined ? undefined : list(input.tags), resourceUrls: input?.resourceUrls === undefined ? undefined : list(input.resourceUrls) } });
    return Response.json({ doubt });
}

export async function exportDoubtsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const doubts = await prisma.doubtItem.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'asc' } });
    const csv = ['title,question,tags,status,resourceUrls', ...doubts.map((doubt) => [doubt.title, doubt.question, doubt.tags.join('|'), doubt.status, doubt.resourceUrls.join('|')].map(csvCell).join(','))].join('\n');
    return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="padhai-karo-doubts.csv"' } });
}
function csvCell(value: string): string { return '"' + value.replaceAll('"', '""') + '"'; }

export async function listCoachingConnectionsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    return Response.json({ connections: await prisma.coachingConnection.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' } }) });
}

export async function createCoachingConnectionHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request); if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const provider = text(input.provider); if (!provider) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'provider is required.');
    const externalId = text(input.externalId) || 'default';
    const connection = await prisma.coachingConnection.upsert({ where: { userId_provider_externalId: { userId: auth.user.id, provider, externalId } }, create: { userId: auth.user.id, provider, externalId, metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata as Prisma.InputJsonValue : undefined }, update: { status: 'CONNECTED', metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata as Prisma.InputJsonValue : undefined } });
    return Response.json({ connection }, { status: 201 });
}

export async function syncCoachingConnectionHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await body(request);
    if (!input) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const provider = text(input.provider); const externalId = text(input.externalId) || 'default';
    let entries: unknown[] = Array.isArray(input.resources) ? input.resources : [];
    const providerUrl = process.env.COACHING_PROVIDER_URL?.trim();
    const providerKey = process.env.COACHING_PROVIDER_API_KEY?.trim();
    if (entries.length === 0 && providerUrl && providerKey) {
        try {
            const response = await fetch(`${providerUrl.replace(/\/$/, '')}/resources?externalId=${encodeURIComponent(externalId)}`, { headers: { Authorization: `Bearer ${providerKey}`, Accept: 'application/json' } });
            if (!response.ok) return errorResponse(502, ErrorCode.REFERENCE_DATA_UNAVAILABLE, `Coaching provider returned HTTP ${response.status}.`);
            const payload = await response.json() as { resources?: unknown };
            entries = Array.isArray(payload.resources) ? payload.resources : [];
        } catch { return errorResponse(502, ErrorCode.REFERENCE_DATA_UNAVAILABLE, 'Coaching provider could not be reached.'); }
    }
    if (!provider || entries.length > 200) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'provider and at most 200 coaching resources are required.');
    const connection = await prisma.coachingConnection.upsert({ where: { userId_provider_externalId: { userId: auth.user.id, provider, externalId } }, create: { userId: auth.user.id, provider, externalId, status: 'SYNCED', metadata: { lastSyncAt: new Date().toISOString(), resourceCount: entries.length } as Prisma.InputJsonValue }, update: { status: 'SYNCED', metadata: { lastSyncAt: new Date().toISOString(), resourceCount: entries.length } as Prisma.InputJsonValue } });
    let imported = 0;
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>; const title = text(row.title);
        if (!title) continue;
        const url = text(row.url) || undefined;
        const existing = url ? await prisma.studyResource.findFirst({ where: { userId: auth.user.id, url, type: 'COACHING' }, select: { id: true } }) : null;
        if (existing) await prisma.studyResource.update({ where: { id: existing.id }, data: { title, tags: [...list(row.tags), provider.toLowerCase()], subjectId: text(row.subjectId) || undefined, chapterId: text(row.chapterId) || undefined } });
        else await prisma.studyResource.create({ data: { userId: auth.user.id, title, url, type: 'COACHING', tags: [...list(row.tags), provider.toLowerCase()], subjectId: text(row.subjectId) || undefined, chapterId: text(row.chapterId) || undefined } });
        imported += 1;
    }
    return Response.json({ connection, imported });
}
