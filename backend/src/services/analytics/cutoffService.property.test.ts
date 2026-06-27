/**
 * Property-based test for the target-cutoff selection round-trip (task 18.4).
 *
 *   - Property 6 (task 18.4): Target cutoff selection round-trip (Req 4.1).
 *
 * Design ("Target Cutoff selection & Score-Gap endpoints", section 4): selecting a cutoff
 * entry that belongs to the active dataset for the user's track persists a *single*
 * current selection for that user (the `TargetCollegeCutoffSelection` model is unique by
 * `userId`, so the handler upserts), such that reading it back returns the same cutoff
 * reference. This property drives `setTargetCutoff` then `getTargetCutoff` through a mocked
 * Prisma client over arbitrary tracks, active years, and valid cutoff ids, asserting:
 *   - selecting a valid cutoff id returns 200,
 *   - reading it back returns a selection scoped to the user whose `cutoffReferenceId`
 *     equals the submitted id, and
 *   - re-selecting a different valid id replaces it (still exactly one selection per user).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts).
 */
import { ExamTrack } from '@prisma/client';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock -------------------------------------------------------------
// In-memory `TargetCollegeCutoffSelection` store keyed by `userId` (the model's unique
// key), so the upsert/findUnique behaviour mirrors the real single-selection-per-user
// constraint. `profile.findUnique` supplies the user's Exam_Track; `cutoffReferenceData`
// supplies the active year (aggregate) and the referenced row (findUnique).
const {
    profileFindUnique,
    cutoffAggregate,
    cutoffFindUnique,
    selectionFindUnique,
    selectionUpsert,
    selectionStore,
} = vi.hoisted(() => {
    const store = new Map<string, { id: string; userId: string; cutoffReferenceId: string }>();
    return {
        selectionStore: store,
        profileFindUnique: vi.fn(),
        cutoffAggregate: vi.fn(),
        cutoffFindUnique: vi.fn(),
        selectionFindUnique: vi.fn(
            async ({ where }: { where: { userId: string } }) => store.get(where.userId) ?? null,
        ),
        selectionUpsert: vi.fn(
            async ({
                where,
                create,
                update,
            }: {
                where: { userId: string };
                create: { userId: string; cutoffReferenceId: string };
                update: { cutoffReferenceId: string };
            }) => {
                const existing = store.get(where.userId);
                const next = existing
                    ? { ...existing, cutoffReferenceId: update.cutoffReferenceId }
                    : { id: `sel-${where.userId}`, userId: create.userId, cutoffReferenceId: create.cutoffReferenceId };
                store.set(where.userId, next);
                return next;
            },
        ),
    };
});

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        cutoffReferenceData: { aggregate: cutoffAggregate, findUnique: cutoffFindUnique },
        targetCollegeCutoffSelection: {
            findUnique: selectionFindUnique,
            upsert: selectionUpsert,
        },
    };
    return { default: prisma, prisma };
});

import type { AuthContext } from '@/lib/auth';
import { getTargetCutoff, setTargetCutoff } from './cutoffService';

function authCtx(userId: string): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function putReq(cutoffReferenceId: string): Request {
    return new Request('http://localhost/api/analytics/target-cutoff', {
        method: 'PUT',
        body: JSON.stringify({ cutoffReferenceId }),
    });
}

beforeEach(() => {
    selectionStore.clear();
    profileFindUnique.mockReset();
    cutoffAggregate.mockReset();
    cutoffFindUnique.mockReset();
    selectionFindUnique.mockClear();
    selectionUpsert.mockClear();
});

describe('target cutoff selection round-trip', () => {
    // Feature: performance-analytics, Property 6: For any cutoff entry in the active
    // dataset for the user's track, selecting it persists a single current selection for
    // that user such that reading it back returns the same cutoff reference.
    it('Property 6: selecting a valid cutoff persists a single selection that reads back identically (Req 4.1)', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.uuid(),
                fc.constantFrom(...(Object.values(ExamTrack) as ExamTrack[])),
                fc.integer({ min: 2015, max: 2030 }),
                // Two distinct cutoff ids both belonging to the active dataset, to exercise
                // the replace-not-append upsert behaviour.
                fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 2 }),
                async (userId, examTrack, activeYear, [firstId, secondId]) => {
                    selectionStore.clear();

                    // The user's profile resolves to the generated track.
                    profileFindUnique.mockResolvedValue({ examTrack });
                    // The active (most recent) cutoff year for the track.
                    cutoffAggregate.mockResolvedValue({ _max: { referenceDataYear: activeYear } });
                    // Any referenced cutoff id belongs to the active dataset: the row mirrors
                    // the requested id and matches the active track + year.
                    cutoffFindUnique.mockImplementation(
                        async ({ where }: { where: { id: string } }) => ({
                            id: where.id,
                            examTrack,
                            referenceDataYear: activeYear,
                            collegeName: 'College',
                            branchName: 'Branch',
                            category: 'General',
                            closingValue: 1000,
                            unit: 'RANK',
                        }),
                    );

                    const auth = authCtx(userId);

                    // 1) Select a valid cutoff -> 200.
                    const setRes = await setTargetCutoff(putReq(firstId), auth);
                    expect(setRes.status).toBe(200);

                    // 2) Read it back: a single selection scoped to the user whose
                    //    cutoffReferenceId equals the submitted id.
                    const getRes = await getTargetCutoff(new Request('http://localhost/api/analytics/target-cutoff'), auth);
                    expect(getRes.status).toBe(200);
                    const { selection } = (await getRes.json()) as {
                        selection: { userId: string; cutoffReferenceId: string } | null;
                    };
                    expect(selection).not.toBeNull();
                    expect(selection?.userId).toBe(userId);
                    expect(selection?.cutoffReferenceId).toBe(firstId);

                    // 3) Re-selecting a different valid id replaces it: still exactly one
                    //    selection for the user, now pointing at the new id.
                    const replaceRes = await setTargetCutoff(putReq(secondId), auth);
                    expect(replaceRes.status).toBe(200);
                    expect(selectionStore.size).toBe(1);

                    const getRes2 = await getTargetCutoff(new Request('http://localhost/api/analytics/target-cutoff'), auth);
                    const { selection: selection2 } = (await getRes2.json()) as {
                        selection: { userId: string; cutoffReferenceId: string } | null;
                    };
                    expect(selection2?.userId).toBe(userId);
                    expect(selection2?.cutoffReferenceId).toBe(secondId);
                },
            ),
        );
    });
});
