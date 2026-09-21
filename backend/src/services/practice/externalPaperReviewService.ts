import { Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

import { analyseExternalPaper } from './externalPaperAnalysis';
import { validateExternalPaperReviewInput } from './externalPaperReviewValidation';
import { analysePaperDocumentText } from './paperDocumentInsights';

async function body(request: Request): Promise<unknown> {
    try { return await request.json(); } catch { return null; }
}

export interface ExternalPaperReviewRouteContext { params: { id: string } | Promise<{ id: string }> }

/** Creates a self-reported paper review plus a linked analytics point, scoped to its owner. */
export async function createExternalPaperReviewHandler(request: Request, auth: AuthContext): Promise<Response> {
    const validation = validateExternalPaperReviewInput(await body(request));
    if (!validation.ok) return errorResponse(422, ErrorCode.VALIDATION_ERROR, validation.message, validation.details);
    const input = validation.value;

    const [document, profile] = await Promise.all([
        input.documentId ? prisma.pdfDocument.findFirst({ where: { id: input.documentId, userId: auth.user.id }, select: { id: true, extractedText: true } }) : null,
        prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true } }),
    ]);
    if (input.documentId && !document) return errorResponse(404, ErrorCode.NOT_FOUND, 'The attached PDF was not found in your library.');

    const history = await prisma.externalPaperReview.findMany({
        where: { userId: auth.user.id, testDate: { lte: input.testDate } }, orderBy: [{ testDate: 'desc' }, { createdAt: 'desc' }], take: 8,
        select: { testDate: true, obtainedScore: true, maxScore: true, analysis: true },
    });
    const previous = history[0];
    const previousAnalysis = previous?.analysis && typeof previous.analysis === 'object' && !Array.isArray(previous.analysis)
        ? previous.analysis as Record<string, unknown> : null;
    const previousScorePercent = typeof previousAnalysis?.scorePercent === 'number' ? previousAnalysis.scorePercent : null;
    const baseAnalysis = analyseExternalPaper(input, previousScorePercent, history.map((review) => ({ date: review.testDate, obtainedScore: review.obtainedScore, maxScore: review.maxScore })));
    const analysis = document ? { ...baseAnalysis, documentInsights: analysePaperDocumentText(document.extractedText, profile?.examProgram ?? null) } : baseAnalysis;

    const review = await prisma.$transaction(async (tx) => {
        const score = await tx.externalMockScore.create({
            data: { userId: auth.user.id, source: 'OTHER', sourceName: input.sourceName ?? `External paper: ${input.title}`, testDate: input.testDate, obtainedScore: input.obtainedScore, maxScore: input.maxScore },
        });
        return tx.externalPaperReview.create({
            data: {
                userId: auth.user.id, title: input.title, sourceName: input.sourceName, testDate: input.testDate,
                obtainedScore: input.obtainedScore, maxScore: input.maxScore, breakdown: input.breakdown as unknown as Prisma.InputJsonValue,
                mistakeTags: input.mistakeTags, selfNotes: input.selfNotes, documentId: input.documentId,
                externalMockScoreId: score.id, analysis: analysis as unknown as Prisma.InputJsonValue,
            },
        });
    });
    return Response.json({ review }, { status: 201 });
}

export async function listExternalPaperReviewsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const reviews = await prisma.externalPaperReview.findMany({
        where: { userId: auth.user.id }, orderBy: [{ testDate: 'desc' }, { createdAt: 'desc' }], take: 30,
    });
    return Response.json({ reviews });
}

export async function getExternalPaperReviewHandler(_request: Request, auth: AuthContext, context: ExternalPaperReviewRouteContext): Promise<Response> {
    const { id } = await context.params;
    const review = await prisma.externalPaperReview.findFirst({ where: { id, userId: auth.user.id } });
    if (!review) return errorResponse(404, ErrorCode.NOT_FOUND, 'External paper review not found.');
    return Response.json({ review });
}

export async function deleteExternalPaperReviewHandler(_request: Request, auth: AuthContext, context: ExternalPaperReviewRouteContext): Promise<Response> {
    const { id } = await context.params;
    const review = await prisma.externalPaperReview.findFirst({ where: { id, userId: auth.user.id }, select: { id: true, externalMockScoreId: true } });
    if (!review) return errorResponse(404, ErrorCode.NOT_FOUND, 'External paper review not found.');
    await prisma.$transaction(async (tx) => {
        await tx.externalPaperReview.delete({ where: { id: review.id } });
        if (review.externalMockScoreId) await tx.externalMockScore.deleteMany({ where: { id: review.externalMockScoreId, userId: auth.user.id } });
    });
    return new Response(null, { status: 204 });
}
