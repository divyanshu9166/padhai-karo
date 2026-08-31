import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { liveProviderConfigured, summarizeImageWithGemini, summarizeWithGemini, transcribeAudio } from './liveProvider';

function extractiveSummary(text: string, title?: string): { title: string; keyPoints: string[]; revisionCapsule: string[]; flashcards: { question: string; answer: string }[] } {
    const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    const keyPoints = (sentences.length > 0 ? sentences : [text.trim()]).slice(0, 7).map((sentence) => sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence);
    const revisionCapsule = keyPoints.slice(0, 5);
    const flashcards = keyPoints.slice(0, 4).map((point, index) => ({ question: `What is the key idea ${index + 1} from this note?`, answer: point }));
    return { title: title?.trim() || keyPoints[0]?.slice(0, 60) || 'Quick revision note', keyPoints, revisionCapsule, flashcards };
}

function sourceText(input: Record<string, unknown>): string {
    for (const key of ['text', 'ocrText', 'transcript']) {
        if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim();
    }
    return '';
}

class AiQuotaRaceError extends Error {}

export async function createOpenNoteHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const inputType = input.inputType === 'PHOTO' || input.inputType === 'VOICE' || input.inputType === 'TEXT' ? input.inputType : null;
    let text = sourceText(input);
    if (!inputType) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'inputType must be TEXT, PHOTO or VOICE.');
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { subscriptionTier: true, aiQuota: true } });
    if (!profile) return errorResponse(404, ErrorCode.NOT_FOUND, 'Complete onboarding before using AI notes.');
    if (profile.subscriptionTier === 'FREE') return errorResponse(402, ErrorCode.UPGRADE_REQUIRED, 'AI notes summarization requires a paid subscription.');
    if (profile.aiQuota <= 0) return errorResponse(429, ErrorCode.QUOTA_EXCEEDED, 'Your AI usage quota has been exhausted.');
    if (inputType === 'PHOTO' && (typeof input.imageData !== 'string' || !input.imageData.trim())) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A note photo is required.');
    if (inputType === 'VOICE' && (typeof input.audioData !== 'string' || !input.audioData.trim())) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'An audio recording is required.');
    if (inputType === 'TEXT' && !text) return errorResponse(422, ErrorCode.EMPTY_INPUT, 'Add note text before creating notes.');
    try {
        if (inputType === 'PHOTO' && typeof input.imageData === 'string' && input.imageData.trim()) {
            if (!liveProviderConfigured()) return errorResponse(503, ErrorCode.AI_PROVIDER_UNAVAILABLE, 'Configure the AI provider before processing a photo.');
            const result = await summarizeImageWithGemini(input.imageData, typeof input.mimeType === 'string' ? input.mimeType : 'image/jpeg');
            const summary = { ...result, title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : result.title };
            return persistOpenNote(auth.user.id, inputType, summary, 'GEMINI_VISION');
        }
        if (inputType === 'VOICE' && typeof input.audioData === 'string' && input.audioData.trim()) {
            text = await transcribeAudio(input.audioData, typeof input.mimeType === 'string' ? input.mimeType : 'audio/mp4');
        }
        if (!text) return errorResponse(422, ErrorCode.EMPTY_INPUT, 'Add text, a note photo or an audio recording before creating notes.');
        const summary = liveProviderConfigured() && inputType === 'TEXT'
            ? { ...(await summarizeWithGemini(text)), title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : undefined }
            : extractiveSummary(text, typeof input.title === 'string' ? input.title : undefined);
        const voiceMeta = inputType === 'VOICE' ? await autoTagVoice(auth.user.id, text) : undefined;
        return persistOpenNote(auth.user.id, inputType, summary, liveProviderConfigured() && inputType === 'TEXT' ? 'GEMINI_TEXT' : 'LOCAL_EXTRACTIVE', text, typeof input.audioUri === 'string' ? input.audioUri : undefined, voiceMeta, typeof input.voiceNoteId === 'string' ? input.voiceNoteId : undefined);
    } catch (error) {
        if (error instanceof AiQuotaRaceError) return errorResponse(429, ErrorCode.QUOTA_EXCEEDED, 'Your AI usage quota has been exhausted.');
        return errorResponse(503, ErrorCode.AI_PROVIDER_UNAVAILABLE, 'The AI provider is currently unavailable. Please retry.');
    }
}

async function autoTagVoice(userId: string, transcription: string): Promise<{ chapterId?: string; subjectId?: string; tags: string[] }> {
    const candidates = await prisma.chapter.findMany({ where: { userId }, select: { id: true, subjectId: true, name: true }, take: 300 });
    const words = new Set(transcription.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const match = candidates
        .map((item) => {
            const chapterWords = item.name.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length >= 4) ?? [];
            const overlap = chapterWords.filter((word) => words.has(word)).length;
            const required = chapterWords.length <= 1 ? 1 : 2;
            return { item, overlap, required };
        })
        .filter((candidate) => candidate.overlap >= candidate.required)
        .sort((a, b) => b.overlap - a.overlap || b.item.name.length - a.item.name.length)[0]?.item;
    return match ? { chapterId: match.id, subjectId: match.subjectId, tags: [match.name.toLowerCase(), 'voice-note'] } : { tags: ['voice-note'] };
}

async function persistOpenNote(userId: string, inputType: 'TEXT' | 'PHOTO' | 'VOICE', summary: { title?: string; keyPoints: string[]; revisionCapsule?: string[]; flashcards?: { question: string; answer: string }[] }, provider: string, transcription?: string, audioUri?: string, voiceMeta?: { chapterId?: string; subjectId?: string; tags: string[] }, voiceNoteId?: string): Promise<Response> {
    const { note: created, remainingQuota } = await prisma.$transaction(async (tx) => {
        const claimed = await tx.profile.updateMany({ where: { userId, subscriptionTier: 'PAID', aiQuota: { gt: 0 } }, data: { aiQuota: { decrement: 1 } } });
        if (claimed.count !== 1) throw new AiQuotaRaceError('AI quota was exhausted while processing the request.');
        const note = await tx.noteSummary.create({ data: { userId, inputType, summary: summary as unknown as Prisma.InputJsonValue } });
        if (inputType === 'VOICE') {
            const voiceData = { title: summary.title || 'Voice note', transcription: transcription || undefined, audioUri: audioUri || undefined, chapterId: voiceMeta?.chapterId, subjectId: voiceMeta?.subjectId, tags: voiceMeta?.tags ?? ['voice-note'], searchText: `${summary.title || 'Voice note'} ${transcription || ''}`.trim() };
            if (voiceNoteId) await tx.voiceNote.updateMany({ where: { id: voiceNoteId, userId }, data: voiceData });
            else await tx.voiceNote.create({ data: { userId, ...voiceData } });
        }
        await tx.aiUsageEvent.create({ data: { userId, outcome: 'PRODUCED', summaryId: note.id } });
        const points = (summary.revisionCapsule ?? summary.keyPoints).filter(Boolean).slice(0, 20);
        if (points.length > 0) {
            await tx.quickRevisionCapsule.create({ data: { userId, title: summary.title || 'AI revision capsule', points: points as unknown as Prisma.InputJsonValue, sourceNoteId: note.id } });
            const cards = summary.flashcards ?? points.slice(0, 6).map((point, index) => ({ question: 'Recall point ' + (index + 1), answer: point }));
            await tx.revisionCard.createMany({ data: cards.map((card) => ({ userId, title: summary.title || 'AI active recall', prompt: card.question, answer: card.answer, sourceType: 'NOTE', sourceId: note.id, tags: ['ai-note'], dueAt: new Date() })) });
        }
        const profile = await tx.profile.findUnique({ where: { userId }, select: { aiQuota: true } });
        return { note, remainingQuota: profile?.aiQuota ?? 0 };
    });
    return Response.json({ summary: created, remainingQuota, source: provider, message: 'Your note was converted into a revision capsule and active-recall cards.' }, { status: 201 });
}

export async function listOpenNotesHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const summaries = await prisma.noteSummary.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return Response.json({ summaries });
}
