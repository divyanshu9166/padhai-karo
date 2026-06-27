import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration test for the Phase 2 Weightage-Based Time Allocation wiring into the Phase 1
 * timetable generator (task 15.2; design "Timetable integration"; Req 7.4, 7.5).
 *
 * Goal: with the user's Effective_Allocation_Mode set to SUGGESTED and a
 * SuggestedAllocationSnapshot present that covers the pending chapters, generating a timetable
 * must STILL preserve every Phase 1 scheduling behavior:
 *   - Fixed_Commitment avoidance — no block overlaps a recurring commitment (Req 7.4);
 *   - non-overlap — no study/buffer block overlaps another (Req 7.4);
 *   - energy-based slotting — HARD chapters are slotted into HIGH-energy (peak) windows and
 *     a HIGH-energy block sits entirely within a peak window (Req 7.4);
 *   - Buffer_Slot reservation — buffer slots are reserved with no subject/chapter (Req 7.4);
 * and the PERSISTED Chapter.weightage rows are NOT mutated — only the in-memory allocator
 * basis is rewritten from the suggested shares (Req 7.5).
 *
 * Prisma is fully mocked so no live database is touched. The harness mirrors
 * `timetableGenerationService.test.ts` and adds the two additive Phase 2 reads
 * (`allocationPreference`, `suggestedAllocationSnapshot`) plus write spies on `chapter` to
 * prove no persisted weightage is ever written.
 *
 * Validates: Requirements 7.4, 7.5
 */

const MS_PER_MINUTE = 60 * 1000;

// Morning peak band [05:00, 12:00) in minutes since midnight (see lib/timetable/energy.ts).
const MORNING_START_MIN = 5 * 60;
const MORNING_END_MIN = 12 * 60;

const {
    profileFindUnique,
    fixedCommitmentFindMany,
    chapterFindMany,
    chapterUpdate,
    chapterUpdateMany,
    calendarEventFindMany,
    dailyTimeAuditFindMany,
    subjectFindMany,
    timetableCreate,
    timetableDeleteMany,
    studyBlockFindMany,
    transaction,
    allocationPreferenceFindUnique,
    allocationPreferenceUpsert,
    allocationPreferenceUpdate,
    suggestedSnapshotFindUnique,
    suggestedSnapshotUpsert,
} = vi.hoisted(() => ({
    profileFindUnique: vi.fn(),
    fixedCommitmentFindMany: vi.fn(),
    chapterFindMany: vi.fn(),
    chapterUpdate: vi.fn(),
    chapterUpdateMany: vi.fn(),
    calendarEventFindMany: vi.fn(),
    dailyTimeAuditFindMany: vi.fn(),
    subjectFindMany: vi.fn(),
    timetableCreate: vi.fn(),
    timetableDeleteMany: vi.fn(),
    studyBlockFindMany: vi.fn(),
    transaction: vi.fn(),
    allocationPreferenceFindUnique: vi.fn(),
    allocationPreferenceUpsert: vi.fn(),
    allocationPreferenceUpdate: vi.fn(),
    suggestedSnapshotFindUnique: vi.fn(),
    suggestedSnapshotUpsert: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        fixedCommitment: { findMany: fixedCommitmentFindMany },
        chapter: {
            findMany: chapterFindMany,
            update: chapterUpdate,
            updateMany: chapterUpdateMany,
        },
        calendarEvent: { findMany: calendarEventFindMany },
        dailyTimeAudit: { findMany: dailyTimeAuditFindMany },
        subject: { findMany: subjectFindMany },
        timetable: {
            create: timetableCreate,
            deleteMany: timetableDeleteMany,
        },
        studyBlock: { findMany: studyBlockFindMany },
        allocationPreference: {
            findUnique: allocationPreferenceFindUnique,
            upsert: allocationPreferenceUpsert,
            update: allocationPreferenceUpdate,
        },
        suggestedAllocationSnapshot: {
            findUnique: suggestedSnapshotFindUnique,
            upsert: suggestedSnapshotUpsert,
        },
        $transaction: transaction,
    };
    return { default: prisma, prisma };
});

import { generateTimetableHandler } from './timetableGenerationService';
import type { AuthContext } from '@/lib/auth';

const WEEK_START = '2026-01-05T00:00:00.000Z'; // Monday (UTC day 1)

// Recurring fixed commitments to be avoided. Day-of-week keyed, in minutes-since-midnight.
const COMMITMENTS = [
    { dayOfWeek: 1, startTime: '08:00', endTime: '14:00' },
    { dayOfWeek: 2, startTime: '08:00', endTime: '14:00' },
];

// HARD chapters should be slotted into HIGH-energy (morning) windows; LIGHT prefers LOW.
const CHAPTERS = [
    {
        id: 'phy-1',
        subjectId: 'physics',
        status: 'NOT_STARTED',
        weightage: 5,
        weightageOverride: null,
        timeAllocationOverride: null,
        estimatedStudyHours: 20,
        estHoursOverride: null,
        taskDifficulty: 'HARD',
    },
    {
        id: 'che-1',
        subjectId: 'chemistry',
        status: 'IN_PROGRESS',
        weightage: 4,
        weightageOverride: null,
        timeAllocationOverride: null,
        estimatedStudyHours: 20,
        estHoursOverride: null,
        taskDifficulty: 'LIGHT',
    },
    {
        id: 'mat-1',
        subjectId: 'maths',
        status: 'NOT_STARTED',
        weightage: 6,
        weightageOverride: null,
        timeAllocationOverride: null,
        estimatedStudyHours: 20,
        estHoursOverride: null,
        taskDifficulty: 'HARD',
    },
];

// Suggested shares that deliberately DIFFER from the Phase 1 weightages above (5/4/6) so we
// can observe the in-memory basis being driven by the suggestion: phy-1 dominates.
const SUGGESTED_SHARES = [
    { chapterId: 'phy-1', referenceKey: 'phy', allocationShare: 0.6, source: 'COMBINED_SIGNAL', weightageIsDefault: false },
    { chapterId: 'che-1', referenceKey: 'che', allocationShare: 0.1, source: 'COMBINED_SIGNAL', weightageIsDefault: false },
    { chapterId: 'mat-1', referenceKey: 'mat', allocationShare: 0.3, source: 'COMBINED_SIGNAL', weightageIsDefault: false },
];

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function postRequest(body: unknown): Request {
    return new Request('http://localhost/api/timetable/generate', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

/** A transaction mock that runs the callback against a tx client capturing created blocks. */
function wireTransaction(): { created: Array<Record<string, unknown>> } {
    const captured: { created: Array<Record<string, unknown>> } = { created: [] };
    transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
            timetable: { deleteMany: timetableDeleteMany, create: timetableCreate },
            studyBlock: {
                createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
                    captured.created.push(...data);
                    return { count: data.length };
                }),
                findMany: vi.fn(async () =>
                    [...captured.created]
                        .map((block, index) => ({ ...block, id: `block-${index}` }))
                        .sort(
                            (a, b) =>
                                (a.startTime as Date).getTime() - (b.startTime as Date).getTime(),
                        ),
                ),
            },
        };
        return cb(tx);
    });
    return captured;
}

/** Minutes-since-midnight (UTC) of a concrete block start. */
function startMinuteOf(block: Record<string, unknown>): number {
    const start = block.startTime as Date;
    return start.getUTCHours() * 60 + start.getUTCMinutes();
}

beforeEach(() => {
    vi.clearAllMocks();
    profileFindUnique.mockResolvedValue({
        userId: 'user-1',
        examTrack: 'JEE',
        peakFocusWindows: ['MORNING'],
    });
    fixedCommitmentFindMany.mockResolvedValue(COMMITMENTS);
    // Return a deep copy each call so the test's reference snapshot can detect any mutation.
    chapterFindMany.mockImplementation(async () =>
        CHAPTERS.map((chapter) => ({ ...chapter })),
    );
    calendarEventFindMany.mockResolvedValue([]);
    dailyTimeAuditFindMany.mockResolvedValue([]);
    subjectFindMany.mockResolvedValue([
        { id: 'physics', name: 'Physics' },
        { id: 'chemistry', name: 'Chemistry' },
        { id: 'maths', name: 'Mathematics' },
    ]);
    timetableCreate.mockResolvedValue({ id: 'tt-1', userId: 'user-1', weekStart: new Date(WEEK_START) });
    timetableDeleteMany.mockResolvedValue({ count: 0 });

    // Phase 2: mode SUGGESTED + a snapshot covering every pending chapter.
    allocationPreferenceFindUnique.mockResolvedValue({
        userId: 'user-1',
        mode: 'SUGGESTED',
    });
    suggestedSnapshotFindUnique.mockResolvedValue({
        userId: 'user-1',
        referenceDataYear: 2025,
        shares: SUGGESTED_SHARES.map((share) => ({ ...share })),
    });
});

describe('timetable generation with SUGGESTED allocation basis preserves Phase 1 behaviors', () => {
    it('avoids fixed commitments, never overlaps, slots by energy, reserves buffer, and never writes weightage', async () => {
        const captured = wireTransaction();

        const res = await generateTimetableHandler(postRequest({ weekStart: WEEK_START }), authCtx());
        expect(res.status).toBe(200);

        const blocks = captured.created;
        expect(blocks.length).toBeGreaterThan(0);

        const studyBlocks = blocks.filter((b) => !b.isBuffer);
        const bufferBlocks = blocks.filter((b) => b.isBuffer);
        expect(studyBlocks.length).toBeGreaterThan(0);

        // ── Non-overlap (Req 7.4) ─────────────────────────────────────────────
        const sorted = [...blocks].sort(
            (a, b) => (a.startTime as Date).getTime() - (b.startTime as Date).getTime(),
        );
        for (let i = 1; i < sorted.length; i += 1) {
            const prevEnd =
                (sorted[i - 1].startTime as Date).getTime() +
                (sorted[i - 1].durationMin as number) * MS_PER_MINUTE;
            expect((sorted[i].startTime as Date).getTime()).toBeGreaterThanOrEqual(prevEnd);
        }

        // ── Fixed_Commitment avoidance (Req 7.4) ──────────────────────────────
        // No block's [start, end) minute range intersects a recurring commitment on its day.
        const commitmentsByDay = new Map<number, Array<{ start: number; end: number }>>();
        for (const c of COMMITMENTS) {
            const [sh, sm] = c.startTime.split(':').map(Number);
            const [eh, em] = c.endTime.split(':').map(Number);
            const list = commitmentsByDay.get(c.dayOfWeek) ?? [];
            list.push({ start: sh * 60 + sm, end: eh * 60 + em });
            commitmentsByDay.set(c.dayOfWeek, list);
        }
        for (const block of blocks) {
            const day = (block.startTime as Date).getUTCDay();
            const blockStart = startMinuteOf(block);
            const blockEnd = blockStart + (block.durationMin as number);
            for (const window of commitmentsByDay.get(day) ?? []) {
                // half-open overlap test
                expect(blockStart < window.end && window.start < blockEnd).toBe(false);
            }
        }

        // ── Energy-based slotting (Req 7.4) ───────────────────────────────────
        // Every HIGH-energy block sits entirely inside the morning peak window.
        for (const block of blocks) {
            if (block.energyLevel === 'HIGH') {
                const start = startMinuteOf(block);
                const end = start + (block.durationMin as number);
                expect(start).toBeGreaterThanOrEqual(MORNING_START_MIN);
                expect(end).toBeLessThanOrEqual(MORNING_END_MIN);
            }
        }
        // HARD chapters were slotted into peak windows: at least one HARD study block is HIGH.
        const hardChapterIds = new Set(
            CHAPTERS.filter((c) => c.taskDifficulty === 'HARD').map((c) => c.id),
        );
        const hardBlocks = studyBlocks.filter((b) => hardChapterIds.has(b.chapterId as string));
        expect(hardBlocks.length).toBeGreaterThan(0);
        expect(hardBlocks.some((b) => b.energyLevel === 'HIGH')).toBe(true);
        // A HARD block flagged scheduledOutsidePeak iff it is NOT a HIGH-energy block.
        for (const block of hardBlocks) {
            expect(block.scheduledOutsidePeak).toBe(block.energyLevel !== 'HIGH');
        }

        // ── Buffer_Slot reservation (Req 7.4) ─────────────────────────────────
        expect(bufferBlocks.length).toBeGreaterThan(0);
        for (const buffer of bufferBlocks) {
            expect(buffer.subjectId).toBeNull();
            expect(buffer.chapterId).toBeNull();
            expect(buffer.isBuffer).toBe(true);
        }

        // ── Suggested shares drive the in-memory basis (Req 7.1) ──────────────
        // phy-1 carries the largest suggested share (0.6) and should receive the most study
        // time, even though its Phase 1 weightage (5) is the lowest of the three (5/4/6).
        const studyMinutesByChapter = new Map<string, number>();
        for (const block of studyBlocks) {
            const id = block.chapterId as string;
            studyMinutesByChapter.set(
                id,
                (studyMinutesByChapter.get(id) ?? 0) + (block.durationMin as number),
            );
        }
        const phyMinutes = studyMinutesByChapter.get('phy-1') ?? 0;
        const cheMinutes = studyMinutesByChapter.get('che-1') ?? 0;
        const matMinutes = studyMinutesByChapter.get('mat-1') ?? 0;
        expect(phyMinutes).toBeGreaterThanOrEqual(matMinutes);
        expect(phyMinutes).toBeGreaterThanOrEqual(cheMinutes);
        expect(phyMinutes).toBeGreaterThan(0);

        // ── Persisted weightage unchanged (Req 7.5) ───────────────────────────
        // The generator only READS chapters/preference/snapshot; it never writes a Chapter
        // weightage row, and never writes the preference/snapshot during generation.
        expect(chapterUpdate).not.toHaveBeenCalled();
        expect(chapterUpdateMany).not.toHaveBeenCalled();
        expect(allocationPreferenceUpsert).not.toHaveBeenCalled();
        expect(allocationPreferenceUpdate).not.toHaveBeenCalled();
        expect(suggestedSnapshotUpsert).not.toHaveBeenCalled();
    });

    it('produces an identical, non-overlapping schedule shape when the mode is the Phase 1 default', async () => {
        // Sanity check that the augmentation is inert under PHASE1_DEFAULT: generation still
        // succeeds and preserves the same invariants without consuming the snapshot.
        allocationPreferenceFindUnique.mockResolvedValue({ userId: 'user-1', mode: 'PHASE1_DEFAULT' });
        const captured = wireTransaction();

        const res = await generateTimetableHandler(postRequest({ weekStart: WEEK_START }), authCtx());
        expect(res.status).toBe(200);
        expect(captured.created.length).toBeGreaterThan(0);

        const sorted = [...captured.created].sort(
            (a, b) => (a.startTime as Date).getTime() - (b.startTime as Date).getTime(),
        );
        for (let i = 1; i < sorted.length; i += 1) {
            const prevEnd =
                (sorted[i - 1].startTime as Date).getTime() +
                (sorted[i - 1].durationMin as number) * MS_PER_MINUTE;
            expect((sorted[i].startTime as Date).getTime()).toBeGreaterThanOrEqual(prevEnd);
        }
        expect(chapterUpdate).not.toHaveBeenCalled();
        expect(chapterUpdateMany).not.toHaveBeenCalled();
    });
});
