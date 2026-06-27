import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for timetable specifics (task 6.23):
 *   - delete-block removal behavior (Req 3.7) — via the DELETE handler with Prisma mocked;
 *   - the holiday sprint offer for an upcoming holiday (Req 16.6);
 *   - the exact JEE (Physics/Maths/Chemistry) and NEET (Biology/Physics/Chemistry)
 *     interleave rotation orders (Req 17.2, 17.3).
 *
 * These are focused example/edge-case checks; the universal interleaving bound (Property 16)
 * and load-reshaping (Property 20) live in their own property tests.
 */
const { studyBlockFindUnique, studyBlockDelete } = vi.hoisted(() => ({
    studyBlockFindUnique: vi.fn(),
    studyBlockDelete: vi.fn(),
}));

vi.mock('@/lib/db', () => {
    const prisma = {
        studyBlock: { findUnique: studyBlockFindUnique, delete: studyBlockDelete },
    };
    return { default: prisma, prisma };
});

import {
    ExamTrack,
    interleaveBlocks,
    interleaveSubjectsForTrack,
    violatesInterleaving,
    type InterleaveUnit,
} from '@/lib/timetable';
import { buildHolidaySprintOffer } from '@/services/calendar/holidaySprint';
import { CalendarEventType, DEFAULT_DAILY_STUDY_HOURS, HOLIDAY_FACTOR } from '@/lib/timetable';
import type { AuthContext } from '@/lib/auth';

import { deleteBlockHandler } from './blockEditService';

function authCtx(userId = 'user-1'): AuthContext {
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

function routeCtx(id = 'block-1'): { params: { id: string } } {
    return { params: { id } };
}

/** Build `count` 60-minute blocks for one subject. */
function blocks(subjectId: string, count: number): InterleaveUnit[] {
    return Array.from({ length: count }, () => ({ subjectId, durationMinutes: 60 }));
}

describe('delete-block removal (Req 3.7)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes the owned block and returns 204', async () => {
        studyBlockFindUnique.mockResolvedValue({ id: 'block-1', userId: 'user-1' });
        const res = await deleteBlockHandler(
            new Request('http://localhost'),
            authCtx(),
            routeCtx(),
        );
        expect(res.status).toBe(204);
        expect(studyBlockDelete).toHaveBeenCalledWith({ where: { id: 'block-1' } });
    });

    it('does not delete and returns 404 when the block is absent', async () => {
        studyBlockFindUnique.mockResolvedValue(null);
        const res = await deleteBlockHandler(
            new Request('http://localhost'),
            authCtx(),
            routeCtx(),
        );
        expect(res.status).toBe(404);
        expect(studyBlockDelete).not.toHaveBeenCalled();
    });

    it("refuses to delete another user's block (403) and removes nothing", async () => {
        studyBlockFindUnique.mockResolvedValue({ id: 'block-1', userId: 'someone-else' });
        await expect(
            deleteBlockHandler(new Request('http://localhost'), authCtx(), routeCtx()),
        ).rejects.toMatchObject({ name: 'ForbiddenError' });
        expect(studyBlockDelete).not.toHaveBeenCalled();
    });
});

describe('holiday sprint offer (Req 16.6)', () => {
    const NOW = new Date('2026-05-01T12:00:00.000Z');

    it('offers an intensified plan for an upcoming holiday scaled by HOLIDAY_FACTOR', () => {
        const offer = buildHolidaySprintOffer(
            [
                {
                    type: CalendarEventType.HOLIDAY,
                    startDate: new Date('2026-06-01T00:00:00.000Z'),
                    endDate: new Date('2026-06-05T00:00:00.000Z'),
                },
            ],
            { now: NOW },
        );

        expect(offer.available).toBe(true);
        if (offer.available) {
            expect(offer.plan.days).toBe(5);
            expect(offer.plan.suggestedDailyHours).toBe(DEFAULT_DAILY_STUDY_HOURS * HOLIDAY_FACTOR);
            expect(offer.plan.suggestedTotalHours).toBe(
                DEFAULT_DAILY_STUDY_HOURS * HOLIDAY_FACTOR * 5,
            );
        }
    });

    it('makes no offer when no holiday is upcoming', () => {
        const offer = buildHolidaySprintOffer(
            [
                {
                    type: CalendarEventType.HOLIDAY,
                    startDate: new Date('2026-01-01T00:00:00.000Z'),
                    endDate: new Date('2026-01-10T00:00:00.000Z'),
                },
            ],
            { now: NOW },
        );
        expect(offer.available).toBe(false);
        expect(offer.plan).toBeNull();
    });
});

describe('exact track interleave orders (Req 17.2, 17.3)', () => {
    it('JEE rotates Physics → Mathematics → Chemistry', () => {
        expect(interleaveSubjectsForTrack(ExamTrack.JEE)).toEqual([
            'Physics',
            'Mathematics',
            'Chemistry',
        ]);
        const units = [
            ...blocks('Physics', 2),
            ...blocks('Mathematics', 2),
            ...blocks('Chemistry', 2),
        ];
        const result = interleaveBlocks(units, {
            subjectPriority: interleaveSubjectsForTrack(ExamTrack.JEE),
        });
        expect(result.map((u) => u.subjectId)).toEqual([
            'Physics',
            'Mathematics',
            'Chemistry',
            'Physics',
            'Mathematics',
            'Chemistry',
        ]);
        expect(violatesInterleaving(result)).toBe(false);
    });

    it('NEET rotates Biology → Physics → Chemistry', () => {
        expect(interleaveSubjectsForTrack(ExamTrack.NEET)).toEqual([
            'Biology',
            'Physics',
            'Chemistry',
        ]);
        const units = [
            ...blocks('Biology', 2),
            ...blocks('Physics', 2),
            ...blocks('Chemistry', 2),
        ];
        const result = interleaveBlocks(units, {
            subjectPriority: interleaveSubjectsForTrack(ExamTrack.NEET),
        });
        expect(result.map((u) => u.subjectId)).toEqual([
            'Biology',
            'Physics',
            'Chemistry',
            'Biology',
            'Physics',
            'Chemistry',
        ]);
        expect(violatesInterleaving(result)).toBe(false);
    });
});
