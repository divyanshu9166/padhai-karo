/**
 * Types for the track-keyed reference-data catalog (task 3.1).
 *
 * The catalog is the system-seeded source of truth for Subjects, their Chapters
 * (with Chapter_Weightage, Estimated_Study_Hours, and Task_Difficulty), and the
 * per-track Target_Exam_Date. It is authored as plain TypeScript data so that:
 *
 *  - the Prisma seed script (`prisma/seed.ts`) can upsert Subjects from it, and
 *  - the onboarding service (task 4.1) can copy the canonical chapter list into a
 *    per-user `Chapter` row set, and
 *  - the Reference Data read endpoints (task 3.2) can serve it,
 *
 * all WITHOUT requiring a live database. The enum-like string unions below mirror the
 * Prisma `ExamTrack` and `TaskDifficulty` enums (see prisma/schema.prisma); they are
 * declared structurally here so this module never needs to import the Prisma client.
 */

/** Mirrors the Prisma `ExamTrack` enum. */
export type ExamTrack = 'JEE' | 'NEET';

/** Mirrors the Prisma `TaskDifficulty` enum (Req 13 — hard vs light tasks). */
export type TaskDifficulty = 'HARD' | 'LIGHT';

/**
 * A single canonical chapter within a subject.
 *
 * `weightage` is the Chapter_Weightage — a chapter's relative contribution to the
 * Exam_Track's marks, expressed (by convention in this catalog) as an approximate
 * percentage of the whole paper. Per-track chapter weightages therefore sum to
 * roughly 100, which lets the timetable engine (Req 11) allocate time proportionally
 * across subjects AND chapters without further normalization.
 */
export interface ReferenceChapter {
    /** Stable, globally-unique key used as the per-user Chapter `referenceKey`. */
    referenceKey: string;
    /** Human-readable chapter name. */
    name: string;
    /** Chapter_Weightage: relative mark contribution (~ % of the paper). > 0. */
    weightage: number;
    /** Estimated_Study_Hours required to complete the chapter (Req 12.6). > 0. */
    estimatedStudyHours: number;
    /** Task_Difficulty classification used for energy-based slotting (Req 13). */
    taskDifficulty: TaskDifficulty;
}

/** A subject for an Exam_Track together with its canonical chapter catalog. */
export interface ReferenceSubject {
    /** Stable, unique subject key; also used as the seeded `Subject.id`. */
    key: string;
    /** Display name (e.g. "Physics", "Mathematics", "Biology"). */
    name: string;
    /** The Exam_Track this subject belongs to. */
    examTrack: ExamTrack;
    /** Canonical chapters for this subject. */
    chapters: ReferenceChapter[];
}
