import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    chapterFindFirst: vi.fn(), capsuleCreate: vi.fn(), revisionCreateMany: vi.fn(),
    providerConfigured: vi.fn(), summarize: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        chapter: { findFirst: mocks.chapterFindFirst },
        quickRevisionCapsule: { create: mocks.capsuleCreate },
        revisionCard: { createMany: mocks.revisionCreateMany },
        $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
    };
    return { prisma, default: prisma };
});

vi.mock('@/services/ai/liveProvider', () => ({ liveProviderConfigured: mocks.providerConfigured, summarizeWithGemini: mocks.summarize }));

import type { AuthContext } from '@/lib/auth';
import { generateChapterCapsuleHandler } from './toolsService';

const auth = { user: { id: 'user-1' } } as AuthContext;
const chapter = { id: 'ch1', name: 'Federalism', status: 'IN_PROGRESS', weightage: 1, estimatedStudyHours: 10, subject: { name: 'Polity' } };
const aiPoints = ['Union and state powers', 'Seventh Schedule allocates legislative subjects', 'Cooperative mechanisms support coordination'];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.chapterFindFirst.mockResolvedValue(chapter);
    mocks.capsuleCreate.mockResolvedValue({ id: 'cap1', title: 'Federalism quick revision', points: ['Point A', 'Point B', 'Point C'] });
    mocks.revisionCreateMany.mockResolvedValue({ count: 3 });
    mocks.providerConfigured.mockReturnValue(true);
    mocks.summarize.mockResolvedValue({ keyPoints: aiPoints });
});

describe('generateChapterCapsuleHandler', () => {
    it('creates and labels an AI capsule and its recall cards for the authenticated chapter', async () => {
        const response = await generateChapterCapsuleHandler(new Request('http://local/api/revision-capsules/generate', { method: 'POST', body: JSON.stringify({ chapterId: 'ch1' }) }), auth);
        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.source).toBe('AI');
        expect(mocks.chapterFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ch1', userId: 'user-1' } }));
        expect(mocks.capsuleCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ points: aiPoints }) }));
        expect(mocks.revisionCreateMany).toHaveBeenCalledTimes(1);
    });

    it('uses a clearly labelled deterministic practice template when the provider is not configured', async () => {
        mocks.providerConfigured.mockReturnValue(false);
        const response = await generateChapterCapsuleHandler(new Request('http://local/api/revision-capsules/generate', { method: 'POST', body: JSON.stringify({ chapterId: 'ch1' }) }), auth);
        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.source).toBe('GUIDED_TEMPLATE');
        expect(mocks.capsuleCreate.mock.calls[0][0].data.points).toHaveLength(5);
        expect(mocks.summarize).not.toHaveBeenCalled();
    });
});
