import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration tests for the AI notes success flows (task 16.9; Req 8.1, 8.2, 8.6).
 *
 * These drive the full `POST /ai/summaries` handler end-to-end against a mocked Prisma
 * client and an injected mock {@link AiSummarizer}, so the suite is DB/network-independent
 * and deterministic. Unlike the focused example tests, these assert the complete accepted
 * paths wire together: gates pass → provider called with the validated input → structured
 * summary PERSISTED (Req 8.6) → usage recorded → quota decremented → 201 returned, for both
 *   - TEXT input (Req 8.1), and
 *   - PHOTO/vision input (Req 8.2),
 * and that the persisted summary is then returned by the list endpoint.
 *
 * Validates: Requirements 8.1, 8.2, 8.6
 */

// --- Prisma mock with a tiny in-memory store ---------------------------------
interface SummaryRow {
    id: string;
    userId: string;
    inputType: 'TEXT' | 'PHOTO';
    summary: unknown;
    createdAt: Date;
}

const store = vi.hoisted(() => ({ summaries: [] as unknown[], usage: [] as unknown[] }));

const { findUniqueProfile, updateProfile, createSummary, findManySummary, createUsage } =
    vi.hoisted(() => ({
        findUniqueProfile: vi.fn(),
        updateProfile: vi.fn(),
        createSummary: vi.fn(),
        findManySummary: vi.fn(),
        createUsage: vi.fn(),
    }));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: findUniqueProfile, update: updateProfile },
        noteSummary: { create: createSummary, findMany: findManySummary },
        aiUsageEvent: { create: createUsage },
        $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
    };
    return { default: prisma, prisma };
});

import { createSummaryHandler, listSummariesHandler } from './aiNotesService';
import type { AiSummarizer, AiSummaryResult } from './types';
import type { AuthContext } from '@/lib/auth';

const BASE = 'http://localhost/api/ai/summaries';

function post(body: unknown): Request {
    return new Request(BASE, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

/** A vision/text-capable summarizer returning a fixed structured result. */
function summarizerReturning(result: AiSummaryResult): AiSummarizer {
    return { summarize: vi.fn(async () => result) };
}

let quota: number;

beforeEach(() => {
    store.summaries = [];
    store.usage = [];
    quota = 5;

    findUniqueProfile.mockReset();
    updateProfile.mockReset();
    createSummary.mockReset();
    findManySummary.mockReset();
    createUsage.mockReset();

    findUniqueProfile.mockImplementation(async () => ({ subscriptionTier: 'PAID', aiQuota: quota }));
    createSummary.mockImplementation(async ({ data }: { data: Omit<SummaryRow, 'id' | 'createdAt'> }) => {
        const row: SummaryRow = { id: `sum-${store.summaries.length + 1}`, createdAt: new Date(), ...data };
        store.summaries.push(row);
        return row;
    });
    createUsage.mockImplementation(async ({ data }: { data: unknown }) => {
        store.usage.push(data);
        return data;
    });
    updateProfile.mockImplementation(async () => {
        quota -= 1;
        return { aiQuota: quota };
    });
    findManySummary.mockImplementation(async () => [...store.summaries].reverse());
});

describe('AI notes — TEXT success flow (Req 8.1, 8.6)', () => {
    it('summarizes text, persists the structured summary, and returns it', async () => {
        const result: AiSummaryResult = { title: 'Newton', keyPoints: ['F=ma', 'inertia'] };
        const summarizer = summarizerReturning(result);

        const res = await createSummaryHandler(
            post({ inputType: 'TEXT', text: 'Summarize Newton laws of motion' }),
            authCtx('user-7'),
            summarizer,
        );

        expect(res.status).toBe(201);
        const body = (await res.json()) as { summary: SummaryRow; remainingQuota: number };
        expect(body.remainingQuota).toBe(4);

        // Provider called with the validated TEXT input.
        expect(summarizer.summarize).toHaveBeenCalledWith({
            inputType: 'TEXT',
            text: 'Summarize Newton laws of motion',
        });

        // Structured summary PERSISTED (Req 8.6) and returned.
        expect(store.summaries).toHaveLength(1);
        expect(body.summary.inputType).toBe('TEXT');
        expect(body.summary.summary).toEqual(result);
        // Exactly one usage event linked to the persisted summary.
        expect(store.usage).toEqual([{ userId: 'user-7', outcome: 'PRODUCED', summaryId: body.summary.id }]);

        // The list endpoint now returns the persisted summary.
        const listRes = await listSummariesHandler(new Request(BASE), authCtx('user-7'));
        const listBody = (await listRes.json()) as { summaries: SummaryRow[] };
        expect(listBody.summaries).toHaveLength(1);
        expect(listBody.summaries[0].id).toBe(body.summary.id);
    });
});

describe('AI notes — PHOTO/vision success flow (Req 8.2, 8.6)', () => {
    it('summarizes a photo via the vision model and persists the structured summary', async () => {
        const result: AiSummaryResult = { keyPoints: ['photo point a', 'photo point b'] };
        const summarizer = summarizerReturning(result);

        const res = await createSummaryHandler(
            post({ inputType: 'PHOTO', imageUploadId: 'img-101' }),
            authCtx('user-7'),
            summarizer,
        );

        expect(res.status).toBe(201);
        const body = (await res.json()) as { summary: SummaryRow; remainingQuota: number };

        expect(summarizer.summarize).toHaveBeenCalledWith({
            inputType: 'PHOTO',
            imageUploadId: 'img-101',
        });
        expect(store.summaries).toHaveLength(1);
        expect(body.summary.inputType).toBe('PHOTO');
        expect(body.summary.summary).toEqual(result);
        expect(body.remainingQuota).toBe(4);
    });
});
