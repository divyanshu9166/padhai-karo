import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DB-independent tests for the timetable generation orchestration + read handlers
 * (task 6.5; design "Timetable Generation Service"; Req 3.1, 3.2, 3.3).
 *
 * Prisma is mocked so no live database is touched. We assert the orchestration contract:
 *   - `weekStart` validation (422) before any DB access;
 *   - missing profile → 404;
 *   - the full pipeline persists non-overlapping blocks across all subjects with pending
 *     chapters, with reserved buffer slots, replacing any existing timetable for the week;
 *   - GET returns the persisted blocks for the requested week scoped to the user.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

const MS_PER_MINUTE = 60 * 1000;

const {
    profileFindUnique,
    fixedCommitmentFindMany,
    chapterFindMany,
    calendarEventFindMany,
    dailyTimeAuditFindMany,
    subjectFindMany,
    timetableFindFirst,
    timetableCreate,
    timetableDeleteMany,
    studyBlockCreateMany,
    studyBlockFindMany,
    transaction,
} = vi.hoisted(() => ({
    profileFindUnique: vi.fn(),
    fixedCommitmentFindMany: vi.fn(),
    chapterFindMany: vi.fn(),
    calendarEventFindMany: vi.fn(),
    dailyTimeAuditFindMany: vi.fn(),
    subjectFindMany: vi.fn(),
    timetableFindFirst: vi.fn(),
    timetableCreate: vi.fn(),
    timetableDeleteMany: vi.fn(),
    studyBlockCreateMany: vi.fn(),
    studyBlockFindMany: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        profile: { findUnique: profileFindUnique },
        fixedCommitment: { findMany: fixedCommitmentFindMany },
        chapter: { findMany: chapterFindMany },
        calendarEvent: { findMany: calendarEventFindMany },
        dailyTimeAudit: { findMany: dailyTimeAuditFindMany },
        subject: { findMany: subjectFindMany },
        timetable: {
            findFirst: timetableFindFirst,
            create: timetableCreate,
            deleteMany: timetableDeleteMany,
        },
        studyBlock: { createMany: studyBlockCreateMany, findMany: studyBlockFindMany },
        $transaction: transaction,
    };
    return { default: prisma, prisma };
});

import { generateTimetableHandler, getTimetableHandler } from './timetableGenerationService';
import type { AuthContext } from '@/lib/auth';

const WEEK_START = '2026-01-05T00:00:00.000Z'; // Monday

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
            timetable: {
                deleteMany: timetableDeleteMany,
                create: timetableCreate,
            },
            studyBlock: {
                createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
                    captured.created.push(...data);
                    return { count: data.length };
                }),
                findMany: vi.fn(async () =>
                    // Echo back the captured blocks with synthetic ids, sorted by startTime.
                    [...captured.created]
                        .map((block, index) => ({ ...block, id: `block-${index}` }))
                        .sort(
                            (a: Record<string, unknown>, b: Record<string, unknown>) =>
                                (a.startTime as Date).getTime() - (b.startTime as Date).getTime(),
                        ),
                ),
            },
        };
        return cb(tx);
    });
    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    profileFindUnique.mockResolvedValue({
        userId: 'user-1',
        examTrack: 'JEE',
        peakFocusWindows: ['MORNING'],
    });
    fixedCommitmentFindMany.mockResolvedValue([
        { dayOfWeek: 1, startTime: '08:00', endTime: '14:00' },
        { dayOfWeek: 2, startTime: '08:00', endTime: '14:00' },
    ]);
    chapterFindMany.mockResolvedValue([
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
    ]);
    calendarEventFindMany.mockResolvedValue([]);
    dailyTimeAuditFindMany.mockResolvedValue([]);
    subjectFindMany.mockResolvedValue([
        { id: 'physics', name: 'Physics' },
        { id: 'chemistry', name: 'Chemistry' },
        { id: 'maths', name: 'Mathematics' },
    ]);
    timetableCreate.mockResolvedValue({ id: 'tt-1', userId: 'user-1', weekStart: new Date(WEEK_START) });
    timetableDeleteMany.mockResolvedValue({ count: 0 });
});

describe('generateTimetableHandler', () => {
    it('returns 422 when weekStart is missing (no DB access)', async () => {
        const res = await generateTimetableHandler(postRequest({}), authCtx());
        expect(res.status).toBe(422);
        expect(profileFindUnique).not.toHaveBeenCalled();
    });

    it('returns 422 when weekStart is not a valid date', async () => {
        const res = await generateTimetableHandler(postRequest({ weekStart: 'not-a-date' }), authCtx());
        expect(res.status).toBe(422);
    });

    it('returns 404 when the user has no profile (onboarding incomplete)', async () => {
        profileFindUnique.mockResolvedValue(null);
        const res = await generateTimetableHandler(postRequest({ weekStart: WEEK_START }), authCtx());
        expect(res.status).toBe(404);
    });

    it('persists a non-overlapping, multi-subject timetable with buffer slots', async () => {
        const captured = wireTransaction();

        const res = await generateTimetableHandler(postRequest({ weekStart: WEEK_START }), authCtx());
        expect(res.status).toBe(200);

        // Replaces any existing timetable for this (userId, weekStart) before creating.
        expect(timetableDeleteMany).toHaveBeenCalledWith({
            where: { userId: 'user-1', weekStart: new Date(WEEK_START) },
        });
        expect(timetableCreate).toHaveBeenCalledWith({
            data: { userId: 'user-1', weekStart: new Date(WEEK_START) },
        });

        const body = (await res.json()) as {
            timetable: { id: string };
            studyBlocks: Array<Record<string, unknown>>;
            bufferSlots: Array<Record<string, unknown>>;
        };
        expect(body.timetable.id).toBe('tt-1');
        expect(body.studyBlocks.length).toBeGreaterThan(0);
        expect(body.bufferSlots.length).toBeGreaterThan(0);

        // Persisted blocks are scoped to the user and tied to the new timetable.
        for (const block of captured.created) {
            expect(block.userId).toBe('user-1');
            expect(block.timetableId).toBe('tt-1');
        }

        // No two persisted blocks overlap (Req 3.3).
        const sorted = [...captured.created].sort(
            (a, b) => (a.startTime as Date).getTime() - (b.startTime as Date).getTime(),
        );
        for (let i = 1; i < sorted.length; i += 1) {
            const prevEnd =
                (sorted[i - 1].startTime as Date).getTime() +
                (sorted[i - 1].durationMin as number) * MS_PER_MINUTE;
            expect((sorted[i].startTime as Date).getTime()).toBeGreaterThanOrEqual(prevEnd);
        }

        // Distributed across all three subjects with pending chapters (Req 3.2).
        const studySubjects = new Set(
            captured.created.filter((b) => !b.isBuffer).map((b) => b.subjectId),
        );
        expect(studySubjects).toEqual(new Set(['physics', 'chemistry', 'maths']));

        // Buffer slots carry no subject/chapter (Req 15.1).
        for (const buffer of captured.created.filter((b) => b.isBuffer)) {
            expect(buffer.subjectId).toBeNull();
            expect(buffer.chapterId).toBeNull();
        }
    });

    it('only queries pending chapters (Req 12.3)', async () => {
        wireTransaction();
        await generateTimetableHandler(postRequest({ weekStart: WEEK_START }), authCtx());
        expect(chapterFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { userId: 'user-1', status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
            }),
        );
    });
});

describe('getTimetableHandler', () => {
    function getRequest(query: string): Request {
        return new Request(`http://localhost/api/timetable${query}`);
    }

    it('returns 422 when weekStart is missing', async () => {
        const res = await getTimetableHandler(getRequest(''), authCtx());
        expect(res.status).toBe(422);
        expect(timetableFindFirst).not.toHaveBeenCalled();
    });

    it('returns an empty list when no timetable exists for the week', async () => {
        timetableFindFirst.mockResolvedValue(null);
        const res = await getTimetableHandler(
            getRequest(`?weekStart=${encodeURIComponent(WEEK_START)}`),
            authCtx(),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { studyBlocks: unknown[] };
        expect(body.studyBlocks).toEqual([]);
        expect(studyBlockFindMany).not.toHaveBeenCalled();
    });

    it('returns the persisted blocks for the requested week scoped to the user', async () => {
        timetableFindFirst.mockResolvedValue({ id: 'tt-9' });
        const rows = [{ id: 'b1', timetableId: 'tt-9' }];
        studyBlockFindMany.mockResolvedValue(rows);

        const res = await getTimetableHandler(
            getRequest(`?weekStart=${encodeURIComponent(WEEK_START)}`),
            authCtx('user-7'),
        );
        expect(res.status).toBe(200);

        expect(timetableFindFirst).toHaveBeenCalledWith({
            where: { userId: 'user-7', weekStart: new Date(WEEK_START) },
            orderBy: { createdAt: 'desc' },
        });
        expect(studyBlockFindMany).toHaveBeenCalledWith({
            where: { timetableId: 'tt-9' },
            orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
        });

        const body = (await res.json()) as { studyBlocks: unknown[] };
        expect(body.studyBlocks).toEqual(rows);
    });
});
