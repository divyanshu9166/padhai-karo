/**
 * Property-based test for Mistake-Journal upsert idempotency.
 *
 *   - Property 36 (task 14.3): mistake-journal upsert idempotency (Req 18.4).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts). The flag handler upserts on `(userId, questionId)`, so re-flagging the
 * same question by the same user must UPDATE the single existing entry to reflect the
 * latest flag rather than creating a duplicate. Prisma is mocked with a faithful in-memory
 * upsert keyed on `(userId, questionId)` so the test asserts the handler's where-clause and
 * upsert payload produce exactly one entry across repeated flags.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
const { findUniquePyqAttempt, findUniquePyq, upsertEntry } = vi.hoisted(() => ({
    findUniquePyqAttempt: vi.fn(),
    findUniquePyq: vi.fn(),
    upsertEntry: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        pYQAttempt: { findUnique: findUniquePyqAttempt },
        timedPaperAttempt: { findUnique: vi.fn() },
        pYQ: { findUnique: findUniquePyq },
        mistakeJournalEntry: { upsert: upsertEntry },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';
import { flagMistakeHandler } from './mistakeService';
import { MISTAKE_CATEGORIES } from './mistakeValidation';

interface StoredEntry {
    id: string;
    userId: string;
    questionId: string;
    category: string;
    createdAt: Date;
    updatedAt: Date;
    [key: string]: unknown;
}

function authCtx(userId: string): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function postReq(body: unknown): Request {
    return new Request('http://localhost/api/mistakes', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    findUniquePyqAttempt.mockReset();
    findUniquePyq.mockReset();
    upsertEntry.mockReset();
});

describe('mistake-journal upsert idempotency properties', () => {
    // Feature: jee-neet-study-app, Property 36: For any question flagged more than once by
    // the same user, exactly one mistake-journal entry exists for that user and question,
    // reflecting the latest flag rather than a duplicate.
    it('Property 36: re-flagging the same (user, question) updates one entry, never duplicates (Req 18.4)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 0, max: 10_000 }).map((n) => `user-${n}`),
                fc.integer({ min: 0, max: 10_000 }).map((n) => `q-${n}`),
                fc.constantFrom(...MISTAKE_CATEGORIES),
                fc.constantFrom(...MISTAKE_CATEGORIES),
                async (userId, questionId, category1, category2) => {
                    // Fresh in-memory store per iteration; faithful upsert on (userId, questionId).
                    const store = new Map<string, StoredEntry>();
                    upsertEntry.mockImplementation(
                        async (args: {
                            where: { userId_questionId: { userId: string; questionId: string } };
                            create: Record<string, unknown>;
                            update: Record<string, unknown>;
                        }) => {
                            const key = args.where.userId_questionId;
                            const id = `${key.userId}::${key.questionId}`;
                            const existing = store.get(id);
                            if (existing) {
                                const updated: StoredEntry = {
                                    ...existing,
                                    ...args.update,
                                    updatedAt: new Date(existing.createdAt.getTime() + 1000),
                                };
                                store.set(id, updated);
                                return updated;
                            }
                            const now = new Date();
                            const row: StoredEntry = {
                                id,
                                userId: key.userId,
                                questionId: key.questionId,
                                ...args.create,
                                createdAt: now,
                                updatedAt: now,
                            } as StoredEntry;
                            store.set(id, row);
                            return row;
                        },
                    );

                    // The question is INCORRECT in the attempt -> flaggable. Owned by the user.
                    findUniquePyqAttempt.mockResolvedValue({
                        userId,
                        perQuestion: [
                            {
                                questionId,
                                selectedOption: '3',
                                correctOption: '1',
                                outcome: 'INCORRECT',
                            },
                        ],
                    });
                    findUniquePyq.mockResolvedValue({ subjectId: 'sub-1', correctOption: 1 });

                    const base = { sourceType: 'PYQ', attemptId: 'attempt-1', questionId };

                    const first = await flagMistakeHandler(
                        postReq({ ...base, category: category1 }),
                        authCtx(userId),
                    );
                    const second = await flagMistakeHandler(
                        postReq({ ...base, category: category2 }),
                        authCtx(userId),
                    );

                    expect(first.status).toBe(201); // created
                    expect(second.status).toBe(200); // updated, not duplicated

                    // Exactly one entry for this (user, question), reflecting the latest flag.
                    expect(store.size).toBe(1);
                    const only = [...store.values()][0];
                    expect(only.userId).toBe(userId);
                    expect(only.questionId).toBe(questionId);
                    expect(only.category).toBe(category2);
                },
            ),
        );
    });
});
