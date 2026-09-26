import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    profileFind: vi.fn(), profileUpdateMany: vi.fn(), profileFindAfter: vi.fn(),
    noteCreate: vi.fn(), voiceFind: vi.fn(), voiceUpdateMany: vi.fn(), voiceCreate: vi.fn(),
    chapterFindMany: vi.fn(), capsuleCreate: vi.fn(), cardCreateMany: vi.fn(), usageCreate: vi.fn(),
    usageCount: vi.fn(), usageFindMany: vi.fn(), executeRaw: vi.fn(),
    aiConfigured: vi.fn(), summarizeText: vi.fn(), summarizeImage: vi.fn(), transcribe: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: mocks.profileFind, updateMany: mocks.profileUpdateMany },
        noteSummary: { create: mocks.noteCreate, findMany: vi.fn() },
        voiceNote: { findFirst: mocks.voiceFind, updateMany: mocks.voiceUpdateMany, create: mocks.voiceCreate },
        chapter: { findMany: mocks.chapterFindMany },
        quickRevisionCapsule: { create: mocks.capsuleCreate },
        revisionCard: { createMany: mocks.cardCreateMany },
        aiUsageEvent: { create: mocks.usageCreate, count: mocks.usageCount, findMany: mocks.usageFindMany },
        $executeRaw: mocks.executeRaw,
        $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
    };
    return { prisma, default: prisma };
});

vi.mock('./liveProvider', () => ({
    AiInputError: class AiInputError extends Error {},
    configuredProviderName: vi.fn(() => 'GROQ'),
    liveProviderConfigured: mocks.aiConfigured,
    summarizeWithGemini: mocks.summarizeText,
    summarizeImageWithGemini: mocks.summarizeImage,
    transcribeAudio: mocks.transcribe,
}));

import type { AuthContext } from '@/lib/auth';
import { createOpenNoteHandler } from './openNotesService';

const auth = { user: { id: 'u1' } } as AuthContext;
const summaryResult = { title: 'Constitution', keyPoints: ['Parliamentary government'], revisionCapsule: ['Cabinet is collectively responsible'], flashcards: [{ question: 'Who is collectively responsible?', answer: 'The Council of Ministers.' }] };

function post(input: unknown): Request {
    return new Request('http://local/api/ai/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileFind.mockResolvedValue({ subscriptionTier: 'PAID', aiQuota: 3, trialStartedAt: null, trialEndsAt: null });
    mocks.usageCount.mockResolvedValue(0);
    mocks.usageFindMany.mockResolvedValue([]);
    mocks.executeRaw.mockResolvedValue(1);
    mocks.profileFindAfter.mockResolvedValue({ aiQuota: 2 });
    mocks.profileUpdateMany.mockResolvedValue({ count: 1 });
    mocks.noteCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'n1', ...data }));
    mocks.voiceFind.mockResolvedValue(null);
    mocks.voiceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.chapterFindMany.mockResolvedValue([]);
    mocks.capsuleCreate.mockResolvedValue({ id: 'c1' });
    mocks.cardCreateMany.mockResolvedValue({ count: 1 });
    mocks.usageCreate.mockResolvedValue({ id: 'usage1' });
    mocks.aiConfigured.mockReturnValue(true);
    mocks.summarizeText.mockResolvedValue(summaryResult);
    mocks.summarizeImage.mockResolvedValue(summaryResult);
    mocks.transcribe.mockResolvedValue('Constitutional government notes.');
});

describe('open AI notes route', () => {
    it('persists provider source/title and charges one quota only after successful generation', async () => {
        const response = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'Parliamentary government notes' }), auth);
        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.summary.summary).toMatchObject({ title: 'Constitution', generationSource: 'GROQ_TEXT' });
        expect(mocks.profileUpdateMany).toHaveBeenCalledTimes(1);
        expect(mocks.usageCreate).toHaveBeenCalledTimes(1);
    });

    it('marks local extractive fallback accurately and does not charge AI quota', async () => {
        mocks.aiConfigured.mockReturnValue(false);
        const response = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'The Constitution provides a parliamentary form of government.' }), auth);
        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.source).toBe('LOCAL_EXTRACTIVE');
        expect(body.summary.summary.generationSource).toBe('LOCAL_EXTRACTIVE');
        expect(mocks.profileUpdateMany).not.toHaveBeenCalled();
        expect(mocks.usageCreate).not.toHaveBeenCalled();
    });

    it('summarizes a user-owned uploaded voice note without re-uploading its audio', async () => {
        mocks.voiceFind.mockResolvedValue({ id: 'v1', title: 'Polity', audioUri: '/voice/v1', audioMimeType: 'audio/mp4', audioData: new Uint8Array([1, 2]), transcription: 'Parliamentary government notes', tags: ['voice-note'] });
        const response = await createOpenNoteHandler(post({ inputType: 'VOICE', voiceNoteId: 'v1' }), auth);
        expect(response.status).toBe(201);
        expect(mocks.voiceFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'v1', userId: 'u1' } }));
        expect(mocks.summarizeText).toHaveBeenCalledWith('Parliamentary government notes');
        expect(mocks.transcribe).not.toHaveBeenCalled();
        expect(mocks.voiceUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('keeps a successful transcript when note summarization fails so retry does not transcribe twice', async () => {
        mocks.voiceFind.mockResolvedValueOnce({ id: 'v1', title: 'Polity', audioUri: '/voice/v1', audioMimeType: 'audio/mp4', audioData: new Uint8Array([1, 2]), transcription: null, tags: ['voice-note'] });
        mocks.voiceFind.mockResolvedValueOnce({ id: 'v1', title: 'Polity', audioUri: '/voice/v1', audioMimeType: 'audio/mp4', audioData: new Uint8Array([1, 2]), transcription: 'Constitutional government notes.', tags: ['voice-note'] });
        mocks.summarizeText.mockRejectedValueOnce(new Error('provider unavailable'));

        const failed = await createOpenNoteHandler(post({ inputType: 'VOICE', voiceNoteId: 'v1' }), auth);
        expect(failed.status).toBe(503);
        expect(mocks.voiceUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ transcription: 'Constitutional government notes.' }) }));

        const retried = await createOpenNoteHandler(post({ inputType: 'VOICE', voiceNoteId: 'v1' }), auth);
        expect(retried.status).toBe(201);
        expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    });

    it('does not create a note or decrement quota when a concurrent request consumed the last unit', async () => {
        mocks.profileUpdateMany.mockResolvedValue({ count: 0 });
        const response = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'valid text' }), auth);
        expect(response.status).toBe(429);
        expect(mocks.noteCreate).not.toHaveBeenCalled();
        expect(mocks.usageCreate).not.toHaveBeenCalled();
    });

    describe('free weekly allowance and trial', () => {
        const free = { subscriptionTier: 'FREE', aiQuota: 0, trialStartedAt: null, trialEndsAt: null };
        const usedAt = (count: number) => Array.from({ length: count }, (_, i) => ({ createdAt: new Date(Date.now() - (i + 1) * 60_000) }));

        it('lets a free student create an AI note from the weekly allowance without touching paid quota', async () => {
            mocks.profileFind.mockResolvedValue(free);
            mocks.usageFindMany.mockResolvedValue(usedAt(2));
            const response = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'Parliamentary government notes' }), auth);
            const body = await response.json();
            expect(response.status).toBe(201);
            expect(body.source).toBe('GROQ_TEXT');
            expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
            expect(mocks.profileUpdateMany).not.toHaveBeenCalled();
            expect(mocks.usageCreate).toHaveBeenCalledTimes(1);
            expect(body.aiAllowance).toMatchObject({ plan: 'FREE', limit: 5 });
        });

        it('returns 402 with allowance details once the free weekly notes are used', async () => {
            mocks.profileFind.mockResolvedValue(free);
            mocks.usageFindMany.mockResolvedValue(usedAt(5));
            const response = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'valid text' }), auth);
            const body = await response.json();
            expect(response.status).toBe(402);
            expect(body.error.code).toBe('UPGRADE_REQUIRED');
            expect(body.error.details).toMatchObject({ plan: 'FREE', remaining: 0, limit: 5, trialAvailable: true });
            expect(mocks.summarizeText).not.toHaveBeenCalled();
        });

        it('keeps local extractive notes available when the allowance is used and no AI provider is set', async () => {
            mocks.aiConfigured.mockReturnValue(false);
            mocks.profileFind.mockResolvedValue(free);
            mocks.usageFindMany.mockResolvedValue(usedAt(5));
            const response = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'Articles 12 to 35 cover fundamental rights.' }), auth);
            expect(response.status).toBe(201);
            expect(mocks.usageCreate).not.toHaveBeenCalled();
        });

        it('uses the trial allowance while the trial is active', async () => {
            mocks.profileFind.mockResolvedValue({ ...free, trialStartedAt: new Date(Date.now() - 86_400_000), trialEndsAt: new Date(Date.now() + 86_400_000) });
            mocks.usageCount.mockResolvedValue(24);
            const response = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'valid text' }), auth);
            expect(response.status).toBe(201);
            mocks.usageCount.mockResolvedValue(25);
            const exhausted = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'valid text' }), auth);
            expect(exhausted.status).toBe(402);
            expect((await exhausted.json()).error.details).toMatchObject({ plan: 'TRIAL', limit: 25 });
        });

        it('rejects the note when a concurrent request takes the last free slot inside the transaction', async () => {
            mocks.profileFind.mockResolvedValueOnce(free).mockResolvedValueOnce(free);
            mocks.usageFindMany.mockResolvedValueOnce(usedAt(4)).mockResolvedValueOnce(usedAt(5));
            const response = await createOpenNoteHandler(post({ inputType: 'TEXT', text: 'valid text' }), auth);
            expect(response.status).toBe(429);
            expect(mocks.noteCreate).not.toHaveBeenCalled();
        });
    });
});
