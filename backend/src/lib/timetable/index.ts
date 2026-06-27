/**
 * Public surface of the timetable-generation pipeline library.
 *
 * The deterministic pipeline runs in stages, each a pure module:
 *   - STEP 1 (free-time grid, Req 3.1) — `./grid`
 *   - STEP 2 (calendar-event budget reshaping, Req 16.3–16.5) — `./budget`
 *   - STEPS 3–5 (buffer reservation, weightage allocation, efficiency scaling, Req 11/12.3/14.5/15.1) — `./allocation`
 *   - STEPS 6–7 (difficulty/energy tagging + energy slotting, Req 13) — `./energy`
 *   - STEP 8 (subject interleaving, Req 17) — `./interleave`
 *
 * Shared types and constants live in `./types`. The generation orchestration (task 6.5,
 * `@/services/timetable`) composes these into `POST /timetable/generate`; STEP 9 (materialize
 * + persist) lives there because it owns the database.
 */
export {
    SLOT_MINUTES,
    MINUTES_PER_DAY,
    DAYS_OF_WEEK,
    CalendarEventType,
} from './types';
export type {
    DayOfWeek,
    MinuteInterval,
    WakingWindow,
    GridCommitment,
    DayFreeIntervals,
    FreeTimeGrid,
    BudgetCalendarEvent,
    DayLoad,
    WeeklyBudget,
} from './types';

export {
    DEFAULT_WAKING_WINDOW,
    computeFreeTimeGrid,
    expandDayToSlotStarts,
    freeMinutesInDay,
    freeMinutesInGrid,
} from './grid';

export {
    SCHOOL_EXAM_FACTOR,
    HOLIDAY_FACTOR,
    DEFAULT_DAILY_STUDY_HOURS,
    computeWeeklyBudget,
    weekDatesFromStart,
} from './budget';
export type { WeeklyBudgetOptions } from './budget';

export {
    BUFFER_TARGET_FRACTION,
    BUFFER_MIN_FRACTION,
    BUFFER_MAX_FRACTION,
    reserveBuffer,
    isPendingStatus,
    allocateStudyHours,
} from './allocation';
export type {
    ChapterStatus,
    AllocatorChapter,
    ChapterAllocation,
    AllocationResult,
    AllocationOptions,
    BufferReservation,
} from './allocation';

export {
    PEAK_WINDOW_BANDS,
    peakWindowForMinute,
    classifySlotEnergy,
    classifySlots,
    assignTasksToSlots,
} from './energy';
export type {
    EnergyLevel,
    TaskDifficulty,
    SlotInput,
    EnergySlot,
    StudyTask,
    TaskPlacement,
    SlottingResult,
} from './energy';

export {
    MAX_CONSECUTIVE_SUBJECT_MINUTES,
    ExamTrack,
    JEE_INTERLEAVE_SUBJECTS,
    NEET_INTERLEAVE_SUBJECTS,
    interleaveSubjectsForTrack,
    distinctSubjectCount,
    maxConsecutiveSubjectMinutes,
    violatesInterleaving,
    interleaveBlocks,
} from './interleave';
export type { InterleaveUnit, InterleaveOptions } from './interleave';
