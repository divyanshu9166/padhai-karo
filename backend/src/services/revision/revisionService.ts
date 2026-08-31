import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { scheduleNextReview, type ReviewRating } from '@/lib/revision/schedule';
import { REVISION_SEQUENCE } from '@/lib/revision/sequence';

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function tags(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(0, 20) : []; }

export async function listRevisionCardsHandler(request: Request, auth: AuthContext): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const dueOnly = params.get('dueOnly') !== 'false';
    const now = new Date();
    const cards = await prisma.revisionCard.findMany({
        where: { userId: auth.user.id, suspended: false, ...(dueOnly ? { dueAt: { lte: now } } : {}) },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        take: Math.min(100, Math.max(1, Number(params.get('limit') ?? 30) || 30)),
    });
    return Response.json({ cards, dueCount: await prisma.revisionCard.count({ where: { userId: auth.user.id, suspended: false, dueAt: { lte: now } } }) });
}

export async function createRevisionCardHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const title = text(input.title); const prompt = text(input.prompt); const answer = text(input.answer);
    if (!title || !prompt || !answer) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'title, prompt and answer are required.');
    const dueAt = typeof input.dueAt === 'string' && !Number.isNaN(new Date(input.dueAt).getTime()) ? new Date(input.dueAt) : new Date();
    const card = await prisma.revisionCard.create({ data: { userId: auth.user.id, title, prompt, answer, sourceType: text(input.sourceType) || 'MANUAL', sourceId: text(input.sourceId) || undefined, chapterId: text(input.chapterId) || undefined, tags: tags(input.tags), dueAt } });
    return Response.json({ card }, { status: 201 });
}

export interface RevisionCardRouteContext { params: { id: string } | Promise<{ id: string }> }

export async function reviewRevisionCardHandler(request: Request, auth: AuthContext, context: RevisionCardRouteContext): Promise<Response> {
    const { id } = await context.params;
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    const rating = body && typeof body === 'object' && typeof (body as Record<string, unknown>).rating === 'number' ? Number((body as Record<string, unknown>).rating) : NaN;
    if (![1, 2, 3, 4].includes(rating)) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'rating must be 1, 2, 3 or 4.');
    const card = await prisma.revisionCard.findFirst({ where: { id, userId: auth.user.id } });
    if (!card) return errorResponse(404, ErrorCode.NOT_FOUND, 'Revision card not found.');
    const schedule = scheduleNextReview(card, rating as ReviewRating);
    const updated = await prisma.$transaction(async (tx) => {
        await tx.revisionReview.create({ data: { userId: auth.user.id, cardId: card.id, rating: rating as number } });
        return tx.revisionCard.update({ where: { id: card.id }, data: { intervalDays: schedule.intervalDays, ease: schedule.ease, repetitions: schedule.repetitions, lapses: schedule.lapses, dueAt: schedule.dueAt, lastReviewedAt: new Date() } });
    });
    return Response.json({ card: updated, nextReviewAt: updated.dueAt });
}

export async function createCardsFromNoteHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown; try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const points = Array.isArray(input.points) ? input.points.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean).slice(0, 20) : [];
    if (points.length === 0) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'At least one revision point is required.');
    const sourceId = text(input.sourceId) || undefined;
    const cards = await prisma.revisionCard.createManyAndReturn({ data: points.map((point, index) => ({ userId: auth.user.id, title: text(input.title) || 'Revision point ' + (index + 1), prompt: 'Recall the key idea: ' + point.slice(0, 120), answer: point, sourceType: text(input.sourceType) || 'CAPSULE', sourceId, chapterId: text(input.chapterId) || undefined, tags: tags(input.tags), dueAt: new Date() })) });
    return Response.json({ cards }, { status: 201 });
}

export async function getRevisionScheduleHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const [cards, chapters] = await Promise.all([
        prisma.revisionCard.findMany({ where: { userId: auth.user.id, suspended: false }, orderBy: { dueAt: 'asc' }, select: { id: true, title: true, chapterId: true, sourceId: true, sourceType: true, revisionPhase: true, dueAt: true, intervalDays: true, repetitions: true, tags: true } }),
        // Build sequences from the chapter lifecycle, not from the first N cards. The old
        // card-only approach silently omitted completed chapters once a learner had more
        // than 200 revision cards.
        prisma.chapter.findMany({ where: { userId: auth.user.id, status: { in: ['DONE', 'REVISED'] } }, select: { id: true, name: true, updatedAt: true } }),
    ]);
    const grouped = cards.reduce<Record<string, number>>((acc, card) => { const day = card.dueAt.toISOString().slice(0, 10); acc[day] = (acc[day] ?? 0) + 1; return acc; }, {});
    const cardsByChapter = new Map<string, typeof cards>();
    for (const card of cards) {
        const chapterId = card.chapterId ?? card.sourceId;
        if (!chapterId) continue;
        const current = cardsByChapter.get(chapterId) ?? [];
        current.push(card);
        cardsByChapter.set(chapterId, current);
    }
    const sequences = chapters.map((chapter) => {
        const chapterCards = cardsByChapter.get(chapter.id) ?? [];
        return {
            chapterId: chapter.id,
            chapterName: chapter.name,
            phases: REVISION_SEQUENCE.map((phase) => ({
                phase: phase.phase,
                label: phase.label,
                dueAt: phase.phase === 'FIRST_STUDY' ? chapter.updatedAt : chapterCards.find((card) => card.revisionPhase === phase.phase)?.dueAt ?? null,
                cardId: chapterCards.find((card) => card.revisionPhase === phase.phase)?.id ?? null,
            })),
        };
    });
    return Response.json({ cards, byDate: grouped, sequences });
}
