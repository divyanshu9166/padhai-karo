import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

export interface CurrentAffairsIngestionInput {
    examProgram?: 'UPSC_CSE' | 'SSC_CGL';
    title: string;
    summary: string;
    body?: string;
    category: string;
    tags?: string[];
    syllabusTags?: string[];
    prelimsRelevance?: 'LOW' | 'MEDIUM' | 'HIGH';
    mainsRelevance?: 'LOW' | 'MEDIUM' | 'HIGH';
    sourceName: string;
    sourceUrl: string;
    publishedAt: Date;
    dedupeHash: string;
}

export async function upsertCurrentAffairsItem(input: CurrentAffairsIngestionInput) {
    return prisma.currentAffairsItem.upsert({
        where: { dedupeHash: input.dedupeHash },
        create: { ...input, tags: input.tags ?? [], syllabusTags: input.syllabusTags ?? [input.category] },
        update: { ...input, tags: input.tags ?? [], syllabusTags: input.syllabusTags ?? [input.category] },
    });
}

export async function listCurrentAffairsHandler(request: Request, auth: AuthContext): Promise<Response> {
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const tag = url.searchParams.get('tag');
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true } });
    const where: Prisma.CurrentAffairsItemWhereInput = {
        AND: [
            profile?.examProgram ? { OR: [{ examProgram: profile.examProgram }, { examProgram: null }] } : {},
            category ? { category } : {},
            tag ? { tags: { has: tag } } : {},
        ],
    };
    const items = await prisma.currentAffairsItem.findMany({ where, orderBy: { publishedAt: 'desc' }, take: 100, include: { bookmarks: { where: { userId: auth.user.id }, select: { id: true, read: true, notes: true } } } });
    return Response.json({ items: items.map(({ bookmarks, ...item }) => ({ ...item, bookmark: bookmarks[0] ?? null })) });
}

export async function createCurrentAffairsBookmarkHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const itemId = typeof input.itemId === 'string' ? input.itemId : '';
    if (!itemId || !(await prisma.currentAffairsItem.findUnique({ where: { id: itemId }, select: { id: true } }))) return errorResponse(404, ErrorCode.NOT_FOUND, 'Current-affairs item not found.');
    const bookmark = await prisma.currentAffairsBookmark.upsert({
        where: { userId_itemId: { userId: auth.user.id, itemId } },
        create: { userId: auth.user.id, itemId, read: input.read === true, notes: typeof input.notes === 'string' ? input.notes.trim() : undefined },
        update: { read: input.read === true, notes: typeof input.notes === 'string' ? input.notes.trim() : undefined },
    });
    let revisionCard = null;
    if (input.addToRevision === true) {
        const item = await prisma.currentAffairsItem.findUnique({ where: { id: itemId }, select: { title: true, summary: true, category: true, syllabusTags: true } });
        if (item) revisionCard = await prisma.revisionCard.create({
            data: {
                userId: auth.user.id,
                title: item.title,
                prompt: `Recall why this current-affairs item matters: ${item.title}`,
                answer: item.summary,
                sourceType: 'CURRENT_AFFAIRS',
                sourceId: itemId,
                tags: [...new Set(['current-affairs', item.category, ...item.syllabusTags])],
                dueAt: new Date(),
            },
        });
    }
    return Response.json({ bookmark, revisionCard });
}

export async function listCurrentAffairsBookmarksHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const bookmarks = await prisma.currentAffairsBookmark.findMany({ where: { userId: auth.user.id }, orderBy: { updatedAt: 'desc' }, include: { item: true } });
    return Response.json({ bookmarks });
}
