import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { ENTITLEMENT_PROFILE_SELECT, allowanceExhaustedResponse, claimAiAllowance, resolveAiAllowance, serializeAllowance } from '@/services/subscription/entitlements';
import { AiInputError, configuredProviderName, liveProviderConfigured, summarizeImageWithGemini, summarizeWithGemini, transcribeAudio } from './liveProvider';

const MAX_TEXT_CHARS = 60_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 256;
const MAX_IMAGE_BASE64_CHARS = Math.ceil(14 * 1024 * 1024 * 4 / 3) + 256;

type SummaryContent = { title: string; keyPoints: string[]; revisionCapsule: string[]; flashcards: { question: string; answer: string }[]; generationSource?: string };
type VoiceMeta = { chapterId?: string; subjectId?: string; tags: string[] };

function extractiveSummary(text: string, title?: string): SummaryContent {
    const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    const keyPoints = (sentences.length > 0 ? sentences : [text.trim()]).slice(0, 7).map((sentence) => sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence);
    return {
        title: title?.trim().slice(0, 160) || keyPoints[0]?.slice(0, 60) || 'Quick revision note',
        keyPoints,
        revisionCapsule: keyPoints.slice(0, 5),
        flashcards: keyPoints.slice(0, 4).map((point, index) => ({ question: `What is the key idea ${index + 1} from this note?`, answer: point })),
    };
}

function sourceText(input: Record<string, unknown>): string {
    for (const key of ['text', 'ocrText', 'transcript']) {
        if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim();
    }
    return '';
}

function inputString(input: Record<string, unknown>, key: string, maxLength: number): string | undefined {
    const value = input[key];
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

class AiQuotaRaceError extends Error {}

export async function createOpenNoteHandler(request: Request, auth: AuthContext): Promise<Response> {
    let body: unknown;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Request body must be an object.');
    const input = body as Record<string, unknown>;
    const inputType = input.inputType === 'PHOTO' || input.inputType === 'VOICE' || input.inputType === 'TEXT' ? input.inputType : null;
    if (!inputType) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'inputType must be TEXT, PHOTO or VOICE.');

    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: ENTITLEMENT_PROFILE_SELECT });
    if (!profile) return errorResponse(404, ErrorCode.NOT_FOUND, 'Complete onboarding before using AI notes.');
    // Every plan (including FREE's weekly allowance) may use AI notes while it has notes left.
    // Local extractive notes never call the provider, so they stay available at zero allowance.
    const allowance = await resolveAiAllowance(prisma, auth.user.id, profile);
    if (allowance.remaining <= 0 && liveProviderConfigured()) return allowanceExhaustedResponse(allowance);

    const title = inputString(input, 'title', 160);
    const voiceNoteId = inputString(input, 'voiceNoteId', 100);
    let text = sourceText(input);
    if (inputType === 'TEXT' && !text) return errorResponse(422, ErrorCode.EMPTY_INPUT, 'Add note text before creating notes.');
    if (inputType === 'TEXT' && text.length > MAX_TEXT_CHARS) return errorResponse(413, ErrorCode.VALIDATION_ERROR, `Notes must be ${MAX_TEXT_CHARS} characters or shorter.`);

    if (inputType === 'PHOTO') {
        if (typeof input.imageData !== 'string' || !input.imageData.trim()) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A note photo is required.');
        if (input.imageData.length > MAX_IMAGE_BASE64_CHARS) return errorResponse(413, ErrorCode.VALIDATION_ERROR, 'The note image is too large. Use a smaller JPEG, PNG or WebP image.');
    }
    if (inputType === 'VOICE') {
        if (!text && !voiceNoteId && (typeof input.audioData !== 'string' || !input.audioData.trim())) return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'Provide a voice-note id, transcript or audio recording.');
        if (typeof input.audioData === 'string' && input.audioData.length > MAX_AUDIO_BASE64_CHARS) return errorResponse(413, ErrorCode.VALIDATION_ERROR, 'Audio must be 25 MB or smaller.');
        if (text.length > MAX_TEXT_CHARS) return errorResponse(413, ErrorCode.VALIDATION_ERROR, `Transcribed notes must be ${MAX_TEXT_CHARS} characters or shorter.`);
    }

    let providerOperation = false;
    try {
        const hasAiProvider = liveProviderConfigured();
        if (inputType === 'PHOTO') {
            if (!hasAiProvider) return errorResponse(503, ErrorCode.AI_PROVIDER_UNAVAILABLE, 'Configure the AI provider before processing a photo.');
            providerOperation = true;
            const result = await summarizeImageWithGemini(String(input.imageData), typeof input.mimeType === 'string' ? input.mimeType : 'image/jpeg');
            providerOperation = false;
            const revisionCapsule = Array.isArray(result.revisionCapsule) ? result.revisionCapsule.filter((item): item is string => typeof item === 'string') : [];
            const flashcards = Array.isArray(result.flashcards) ? result.flashcards.flatMap((card) => card && typeof card.question === 'string' && typeof card.answer === 'string' ? [{ question: card.question, answer: card.answer }] : []) : [];
            const summary: SummaryContent = {
                title: title || result.title || 'Photo note',
                keyPoints: result.keyPoints,
                revisionCapsule: revisionCapsule.length ? revisionCapsule : result.keyPoints.slice(0, 5),
                flashcards,
                generationSource: `${configuredProviderName()}_VISION`,
            };
            return await persistOpenNote(auth.user.id, inputType, summary, summary.generationSource!, true);
        }

        let voiceRecord: { id: string; title: string; audioUri: string | null; audioMimeType: string | null; audioData: Uint8Array | null; transcription: string | null; tags: string[] } | null = null;
        let transcriptionWasGenerated = false;
        if (inputType === 'VOICE' && voiceNoteId) {
            voiceRecord = await prisma.voiceNote.findFirst({
                where: { id: voiceNoteId, userId: auth.user.id },
                select: { id: true, title: true, audioUri: true, audioMimeType: true, audioData: true, transcription: true, tags: true },
            });
            if (!voiceRecord) return errorResponse(404, ErrorCode.NOT_FOUND, 'Voice note not found.');
            text ||= voiceRecord.transcription?.trim() ?? '';
        }

        if (inputType === 'VOICE' && !text) {
            const audioData = typeof input.audioData === 'string' && input.audioData.trim()
                ? input.audioData
                : voiceRecord?.audioData
                    ? `data:${voiceRecord.audioMimeType || 'audio/mp4'};base64,${Buffer.from(voiceRecord.audioData).toString('base64')}`
                    : '';
            if (!audioData) return errorResponse(422, ErrorCode.EMPTY_INPUT, 'This voice note has no audio or transcript to process.');
            providerOperation = true;
            text = await transcribeAudio(audioData, typeof input.mimeType === 'string' ? input.mimeType : voiceRecord?.audioMimeType || 'audio/mp4');
            providerOperation = false;
            transcriptionWasGenerated = true;
        }
        if (!text) return errorResponse(422, ErrorCode.EMPTY_INPUT, 'Add text, a note photo or an audio recording before creating notes.');
        if (text.length > MAX_TEXT_CHARS) return errorResponse(413, ErrorCode.VALIDATION_ERROR, `Notes must be ${MAX_TEXT_CHARS} characters or shorter.`);

        // Persist a successful transcription before text summarization. If the summary provider
        // then fails, retrying the saved voice note reuses its transcript instead of paying for
        // another transcription and losing the first result.
        if (inputType === 'VOICE' && voiceRecord && transcriptionWasGenerated) {
            const saved = await prisma.voiceNote.updateMany({ where: { id: voiceRecord.id, userId: auth.user.id }, data: { transcription: text, searchText: `${voiceRecord.title} ${text}`.trim() } });
            if (saved.count !== 1) return errorResponse(404, ErrorCode.NOT_FOUND, 'Voice note not found.');
            voiceRecord = { ...voiceRecord, transcription: text };
        }

        let summary: SummaryContent;
        let source = 'LOCAL_EXTRACTIVE';
        let consumesQuota = transcriptionWasGenerated;
        if (hasAiProvider) {
            providerOperation = true;
            const generated = await summarizeWithGemini(text);
            providerOperation = false;
            const revisionCapsule = Array.isArray(generated.revisionCapsule) ? generated.revisionCapsule.filter((item): item is string => typeof item === 'string') : [];
            const flashcards = Array.isArray(generated.flashcards) ? generated.flashcards.flatMap((card) => card && typeof card.question === 'string' && typeof card.answer === 'string' ? [{ question: card.question, answer: card.answer }] : []) : [];
            summary = {
                title: title || (inputType === 'VOICE' ? voiceRecord?.title : undefined) || generated.title || 'AI study note',
                keyPoints: generated.keyPoints,
                revisionCapsule: revisionCapsule.length ? revisionCapsule : generated.keyPoints.slice(0, 5),
                flashcards,
            };
            source = `${configuredProviderName()}_${inputType}`;
            consumesQuota = true;
        } else {
            summary = extractiveSummary(text, title || (inputType === 'VOICE' ? voiceRecord?.title ?? undefined : undefined));
            if (inputType === 'VOICE' && !transcriptionWasGenerated) source = 'LOCAL_EXTRACTIVE';
            if (inputType === 'VOICE' && transcriptionWasGenerated) source = 'TRANSCRIPTION_PLUS_LOCAL_EXTRACTIVE';
        }

        const voiceMeta = inputType === 'VOICE' ? await autoTagVoice(auth.user.id, text) : undefined;
        const audioUri = typeof input.audioUri === 'string' ? input.audioUri : voiceRecord?.audioUri ?? undefined;
        summary.generationSource = source;
        return await persistOpenNote(auth.user.id, inputType, summary, source, consumesQuota, text, audioUri, voiceMeta, voiceRecord);
    } catch (error) {
        if (error instanceof AiQuotaRaceError) return errorResponse(429, ErrorCode.QUOTA_EXCEEDED, 'Your AI usage quota has been exhausted.');
        if (error instanceof AiInputError) return errorResponse(422, ErrorCode.VALIDATION_ERROR, error.message);
        if (providerOperation) return errorResponse(503, ErrorCode.AI_PROVIDER_UNAVAILABLE, 'The AI provider is currently unavailable. Please retry.');
        throw error;
    }
}

async function autoTagVoice(userId: string, transcription: string): Promise<VoiceMeta> {
    const candidates = await prisma.chapter.findMany({ where: { userId }, select: { id: true, subjectId: true, name: true }, take: 300 });
    const words = new Set(transcription.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const match = candidates
        .map((item) => {
            const chapterWords = item.name.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length >= 4) ?? [];
            const overlap = chapterWords.filter((word) => words.has(word)).length;
            const required = chapterWords.length <= 1 ? 1 : 2;
            return { item, overlap, required };
        })
        .filter((candidate) => candidate.overlap >= candidate.required)
        .sort((a, b) => b.overlap - a.overlap || b.item.name.length - a.item.name.length)[0]?.item;
    return match ? { chapterId: match.id, subjectId: match.subjectId, tags: [match.name.toLocaleLowerCase(), 'voice-note'] } : { tags: ['voice-note'] };
}

async function persistOpenNote(
    userId: string,
    inputType: 'TEXT' | 'PHOTO' | 'VOICE',
    summary: SummaryContent,
    source: string,
    consumesQuota: boolean,
    transcription?: string,
    audioUri?: string,
    voiceMeta?: VoiceMeta,
    voiceRecord?: { id: string; title: string; tags: string[] } | null,
): Promise<Response> {
    const { note: created, remainingQuota, aiAllowance } = await prisma.$transaction(async (tx) => {
        if (consumesQuota && !(await claimAiAllowance(tx, userId))) {
            throw new AiQuotaRaceError('AI quota was exhausted while processing the request.');
        }
        const note = await tx.noteSummary.create({ data: { userId, inputType, summary: summary as unknown as Prisma.InputJsonValue } });
        if (inputType === 'VOICE') {
            const tags = Array.from(new Set([...(voiceRecord?.tags ?? []), ...(voiceMeta?.tags ?? ['voice-note'])]));
            const voiceData = {
                title: summary.title || voiceRecord?.title || 'Voice note',
                transcription: transcription || undefined,
                audioUri: audioUri || undefined,
                chapterId: voiceMeta?.chapterId,
                subjectId: voiceMeta?.subjectId,
                tags,
                searchText: `${summary.title || voiceRecord?.title || 'Voice note'} ${transcription || ''}`.trim(),
            };
            if (voiceRecord) {
                const updated = await tx.voiceNote.updateMany({ where: { id: voiceRecord.id, userId }, data: voiceData });
                if (updated.count !== 1) throw new Error('Voice note ownership changed during processing.');
            } else {
                await tx.voiceNote.create({ data: { userId, ...voiceData } });
            }
        }
        if (consumesQuota) await tx.aiUsageEvent.create({ data: { userId, outcome: 'PRODUCED', summaryId: note.id } });
        const points = (summary.revisionCapsule.length ? summary.revisionCapsule : summary.keyPoints).filter(Boolean).slice(0, 20);
        if (points.length > 0) {
            await tx.quickRevisionCapsule.create({ data: { userId, title: summary.title || 'Study revision capsule', points: points as unknown as Prisma.InputJsonValue, sourceNoteId: note.id } });
            const cards = summary.flashcards.length ? summary.flashcards : points.slice(0, 6).map((point, index) => ({ question: `Recall point ${index + 1}`, answer: point }));
            await tx.revisionCard.createMany({ data: cards.map((card) => ({ userId, title: summary.title || 'Active recall', prompt: card.question, answer: card.answer, sourceType: 'NOTE', sourceId: note.id, tags: ['ai-note'], dueAt: new Date() })) });
        }
        const profile = await tx.profile.findUnique({ where: { userId }, select: ENTITLEMENT_PROFILE_SELECT });
        const allowance = profile ? await resolveAiAllowance(tx, userId, profile) : null;
        return { note, remainingQuota: allowance?.remaining ?? 0, aiAllowance: allowance ? serializeAllowance(allowance) : null };
    });
    return Response.json({ summary: created, remainingQuota, aiAllowance, source, message: 'Your note was saved with a revision capsule and active-recall cards.' }, { status: 201 });
}

export async function listOpenNotesHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const summaries = await prisma.noteSummary.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return Response.json({ summaries });
}
