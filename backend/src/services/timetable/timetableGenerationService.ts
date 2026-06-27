/**
 * Timetable generation orchestration + persistence + read handlers (task 6.5; design
 * "Timetable Generation Service", "Timetable Generation" algorithm; Req 3.1, 3.2, 3.3).
 *
 *   POST /api/timetable/generate  body { weekStart }
 *     -> 200 { timetable, studyBlocks[], bufferSlots[] }
 *     -> 422 VALIDATION_ERROR (missing/invalid weekStart)
 *     -> 404 NOT_FOUND        (user has not completed onboarding → no profile)
 *
 *   GET /api/timetable?weekStart=
 *     -> 200 { studyBlocks[] }   the persisted blocks for that week (study + buffer)
 *     -> 422 VALIDATION_ERROR (missing/invalid weekStart)
 *
 * This module is the THIN orchestration seam: it loads the user's inputs, runs the pure
 * pipeline (STEP 1 free grid → STEP 2 budget → STEPS 3–5 allocation → STEPS 6–8 energy +
 * interleave → STEP 9 materialize), then persists the result. All scheduling intelligence
 * lives in the pure `@/lib/timetable/*` modules and `./materialize`; the no-overlap and
 * fixed-commitment guarantees (Req 3.1/3.3) follow from scheduling only into free-grid slots
 * and are re-asserted by {@link assertNoOverlap} before anything is written.
 *
 * Persistence replaces any existing timetable for the same `(userId, weekStart)` inside a
 * single transaction so a regeneration is atomic. Every read/write is scoped to
 * `auth.user.id`; the route wraps these handlers with `withAuth` so unauthenticated requests
 * are rejected upstream (Req 1.7).
 */
import type { AuthContext } from '@/lib/auth';
import {
    resolveTimetableBasis,
    type EffectiveAllocationMode,
} from '@/lib/allocation/timetableBasis';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';
import {
    allocateStudyHours,
    type AllocatorChapter,
} from '@/lib/timetable/allocation';
import { computeWeeklyBudget, weekDatesFromStart } from '@/lib/timetable/budget';
import { computeFreeTimeGrid } from '@/lib/timetable/grid';
import { interleaveSubjectsForTrack, type ExamTrack } from '@/lib/timetable/interleave';
import {
    type BudgetCalendarEvent,
    type CalendarEventType,
    type GridCommitment,
} from '@/lib/timetable/types';
import { computeEfficiencyScore } from '@/services/audit/efficiencyScore';
import { startOfUtcDay } from '@/services/dashboard';
import type { PeakFocusWindow } from '@/services/onboarding/validation';

import {
    assertNoOverlap,
    materializeTimetable,
    type MaterializeChapter,
    type MaterializedBlock,
} from './materialize';

/** Discriminated result of parsing the `weekStart` input. */
type WeekStartParse =
    | { ok: true; weekStart: Date }
    | { ok: false; response: Response };

/** Parse a `weekStart` value (ISO string or epoch-millis) into a normalized UTC-midnight Date. */
function parseWeekStart(raw: unknown, source: 'body' | 'query'): WeekStartParse {
    if (typeof raw !== 'string' || raw.trim() === '') {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                `"weekStart" is required as a ${source === 'body' ? 'request body field' : 'query parameter'}.`,
                { param: 'weekStart' },
            ),
        };
    }
    const trimmed = raw.trim();
    const candidate = /^[+-]?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed;
    const date = new Date(candidate);
    if (Number.isNaN(date.getTime())) {
        return {
            ok: false,
            response: errorResponse(
                422,
                ErrorCode.VALIDATION_ERROR,
                '"weekStart" must be a valid date.',
                { param: 'weekStart' },
            ),
        };
    }
    return { ok: true, weekStart: startOfUtcDay(date) };
}

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Map the track's canonical subject rotation (subject NAMES, Req 17.2/17.3) onto the user's
 * `subjectId`s, so interleaving has a stable priority order. Subjects without a matching name
 * are simply absent from the priority list (interleaving appends them by first appearance).
 */
function buildSubjectPriority(
    track: ExamTrack,
    subjects: ReadonlyArray<{ id: string; name: string }>,
): string[] {
    const byName = new Map(subjects.map((subject) => [subject.name.toLowerCase(), subject.id]));
    const priority: string[] = [];
    for (const name of interleaveSubjectsForTrack(track)) {
        const id = byName.get(name.toLowerCase());
        if (id) {
            priority.push(id);
        }
    }
    return priority;
}

/** Shape of a persisted study block returned to the client. */
type PersistedBlockInput = MaterializedBlock & { timetableId: string; userId: string };

/**
 * Handle `POST /api/timetable/generate`. Loads the user's profile, commitments, pending
 * chapters, the week's calendar events, and efficiency score; runs the full generation
 * pipeline; then atomically replaces the week's timetable with the freshly materialized
 * blocks. Returns the new timetable plus its study and buffer blocks.
 */
export async function generateTimetableHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const body = await readJsonBody(request);
    const parsed = parseWeekStart(
        body && typeof body === 'object' ? (body as Record<string, unknown>).weekStart : undefined,
        'body',
    );
    if (!parsed.ok) {
        return parsed.response;
    }
    const { weekStart } = parsed;
    const userId = auth.user.id;

    const profile = await prisma.profile.findUnique({ where: { userId } });
    if (!profile) {
        return errorResponse(
            404,
            ErrorCode.NOT_FOUND,
            'Complete onboarding before generating a timetable.',
        );
    }
    const track = profile.examTrack as ExamTrack;
    const peakWindows = (profile.peakFocusWindows ?? []) as PeakFocusWindow[];

    const weekDates = weekDatesFromStart(weekStart);
    const weekEnd = weekDates[weekDates.length - 1];

    const [
        commitmentRows,
        chapterRows,
        eventRows,
        auditRows,
        subjectRows,
        allocationPreference,
        suggestedSnapshot,
    ] = await Promise.all([
        prisma.fixedCommitment.findMany({
            where: { userId },
            select: { dayOfWeek: true, startTime: true, endTime: true },
        }),
        prisma.chapter.findMany({
            where: { userId, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
            select: {
                id: true,
                subjectId: true,
                status: true,
                weightage: true,
                weightageOverride: true,
                timeAllocationOverride: true,
                estimatedStudyHours: true,
                estHoursOverride: true,
                taskDifficulty: true,
            },
        }),
        prisma.calendarEvent.findMany({
            // Events overlapping the target week (inclusive of week boundaries).
            where: { userId, startDate: { lte: weekEnd }, endDate: { gte: weekStart } },
            select: { type: true, startDate: true, endDate: true },
        }),
        prisma.dailyTimeAudit.findMany({
            where: { userId },
            select: { plannedMin: true, actualMin: true },
        }),
        prisma.subject.findMany({
            where: { examTrack: track },
            select: { id: true, name: true },
        }),
        // Phase 2 (additive, read-only): the user's Effective_Allocation_Mode and the most
        // recently computed Suggested_Time_Allocation snapshot. Both are optional and default
        // to the unchanged Phase 1 behavior when absent (Req 7.6, 7.7).
        prisma.allocationPreference.findUnique({ where: { userId } }),
        prisma.suggestedAllocationSnapshot.findUnique({ where: { userId } }),
    ]);

    // STEP 1 — free-time grid (Req 3.1).
    const commitments: GridCommitment[] = commitmentRows.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
    }));
    const freeGrid = computeFreeTimeGrid(commitments);

    // STEP 2 — weekly budget reshaped by calendar events (Req 16).
    const events: BudgetCalendarEvent[] = eventRows.map((row) => ({
        type: row.type as CalendarEventType,
        startDate: row.startDate,
        endDate: row.endDate,
    }));
    const budget = computeWeeklyBudget(weekDates, events);

    // STEPS 3–5 — buffer + weightage allocation + efficiency scaling (Req 11, 12.3, 14.5, 15.1).
    const efficiencyScore = computeEfficiencyScore(auditRows);
    const allocatorChapters: AllocatorChapter[] = chapterRows.map((row) => ({
        id: row.id,
        subjectId: row.subjectId,
        status: row.status,
        weightage: row.weightage,
        weightageOverride: row.weightageOverride,
        timeAllocationOverride: row.timeAllocationOverride,
        estimatedStudyHours: row.estimatedStudyHours,
        estHoursOverride: row.estHoursOverride,
    }));

    // Phase 2 (additive): when the user's Effective_Allocation_Mode is SUGGESTED and a snapshot
    // covering at least one pending Chapter exists, rewrite the in-memory allocator weightage to
    // each Chapter's Suggested_Time_Allocation share; otherwise the Phase 1 weightage is left
    // unchanged. This never mutates persisted Chapter.weightage (Req 7.1, 7.2, 7.5, 7.6, 7.7).
    const snapshotShares = new Map<string, number>();
    if (suggestedSnapshot && Array.isArray(suggestedSnapshot.shares)) {
        for (const entry of suggestedSnapshot.shares as unknown[]) {
            if (entry && typeof entry === 'object') {
                const { chapterId, allocationShare } = entry as {
                    chapterId?: unknown;
                    allocationShare?: unknown;
                };
                if (typeof chapterId === 'string' && typeof allocationShare === 'number') {
                    snapshotShares.set(chapterId, allocationShare);
                }
            }
        }
    }
    const basisChapters = resolveTimetableBasis(
        allocatorChapters,
        (allocationPreference?.mode ?? null) as EffectiveAllocationMode | null,
        snapshotShares,
    );

    const allocation = allocateStudyHours(basisChapters, budget.weeklyBudgetHours, {
        efficiencyScore,
    });

    // STEP 9 — materialize concrete blocks (+ STEPS 6–8 inside, Req 13, 17).
    const difficultyByChapter = new Map(
        chapterRows.map((row) => [row.id, row.taskDifficulty] as const),
    );
    const materializeChapters: MaterializeChapter[] = allocation.allocations.map((entry) => ({
        chapterId: entry.chapterId,
        subjectId: entry.subjectId,
        allocatedHours: entry.allocatedHours,
        taskDifficulty: difficultyByChapter.get(entry.chapterId) ?? 'LIGHT',
    }));

    const { studyBlocks, bufferSlots } = materializeTimetable({
        weekDates,
        perDayLoads: budget.perDay,
        freeGrid,
        peakWindows,
        allocations: materializeChapters,
        bufferHours: allocation.bufferHours,
        assignableHours: allocation.assignableHours,
        subjectPriority: buildSubjectPriority(track, subjectRows),
    });

    // Re-assert the core invariant before persisting (Req 3.1/3.3): no block overlaps another
    // or a fixed commitment (the latter holds because every block sits in a free-grid slot).
    assertNoOverlap([...studyBlocks, ...bufferSlots]);

    // Persist atomically: replace any existing timetable for this (userId, weekStart).
    const { timetable, persistedBlocks } = await prisma.$transaction(async (tx) => {
        await tx.timetable.deleteMany({ where: { userId, weekStart } });
        const created = await tx.timetable.create({ data: { userId, weekStart } });

        const blockData: PersistedBlockInput[] = [...studyBlocks, ...bufferSlots].map((block) => ({
            ...block,
            timetableId: created.id,
            userId,
        }));
        if (blockData.length > 0) {
            await tx.studyBlock.createMany({ data: blockData });
        }
        const stored = await tx.studyBlock.findMany({
            where: { timetableId: created.id },
            orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
        });
        return { timetable: created, persistedBlocks: stored };
    });

    return Response.json(
        {
            timetable,
            studyBlocks: persistedBlocks.filter((block) => !block.isBuffer),
            bufferSlots: persistedBlocks.filter((block) => block.isBuffer),
        },
        { status: 200 },
    );
}

/**
 * Handle `GET /api/timetable?weekStart=`. Returns the persisted study blocks (study + buffer)
 * for the authenticated user's timetable that week, ordered chronologically. Returns an empty
 * list when no timetable has been generated for the week.
 */
export async function getTimetableHandler(
    request: Request,
    auth: AuthContext,
): Promise<Response> {
    const url = new URL(request.url);
    const parsed = parseWeekStart(url.searchParams.get('weekStart'), 'query');
    if (!parsed.ok) {
        return parsed.response;
    }

    const timetable = await prisma.timetable.findFirst({
        where: { userId: auth.user.id, weekStart: parsed.weekStart },
        orderBy: { createdAt: 'desc' },
    });
    if (!timetable) {
        return Response.json({ studyBlocks: [] });
    }

    const studyBlocks = await prisma.studyBlock.findMany({
        where: { timetableId: timetable.id },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });

    return Response.json({ studyBlocks });
}
