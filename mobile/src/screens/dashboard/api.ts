/**
 * Dashboard / chapter / audit / velocity API DTOs and calls (task 21.5).
 *
 * Thin typed wrappers over the Backend_API endpoints this screen consumes, built on the
 * shared typed {@link request} client (which attaches the bearer token from AuthContext and
 * throws a typed `ApiError` on non-2xx). Kept local to the dashboard feature folder so the
 * shared `src/api` surface is owned by the scaffold/auth tasks; the shapes mirror the server
 * handlers in `backend/src/services/{dashboard,chapter,audit}`.
 *
 *   GET   /api/dashboard           → per-subject hours (today/week), streak, syllabus %  (Req 5.1, 5.4, 12.4)
 *   GET   /api/chapters            → chapters with lifecycle status                      (Req 12.1)
 *   PATCH /api/chapters/:id/status → forward-only status transition (422 backward)       (Req 12.1)
 *   POST  /api/audits/daily        → record planned vs actual check-in                   (Req 14.1)
 *   GET   /api/velocity            → AHEAD/BEHIND vs target completion date + day delta   (Req 14.8)
 */

import { request } from '@/api';

/** Chapter lifecycle status, forward-only along NOT_STARTED → IN_PROGRESS → DONE → REVISED. */
export type ChapterStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'REVISED';

/** A per-subject focused-time total (minutes) for a period. Mirrors `PerSubjectStudyTime`. */
export interface PerSubjectStudyTime {
    subjectId: string;
    focusedDurationMin: number;
}

/** Response of `GET /api/dashboard`. */
export interface DashboardResponse {
    perSubjectToday: PerSubjectStudyTime[];
    perSubjectWeek: PerSubjectStudyTime[];
    /** Consecutive days with ≥1 session ending today; zero when none today (Req 5.4). */
    streak: number;
    /** Chapters Done/Revised ÷ total, as a percent (Req 12.4). */
    syllabusCompletionPercent: number;
}

/** A chapter row as returned by `GET /api/chapters` (mirrors `CHAPTER_CLIENT_SELECT`). */
export interface Chapter {
    id: string;
    subjectId: string;
    referenceKey: string;
    name: string;
    status: ChapterStatus;
    weightage: number;
    weightageIsDefault: boolean;
    estimatedStudyHours: number;
    taskDifficulty: string;
    weightageOverride: number | null;
    estHoursOverride: number | null;
    timeAllocationOverride: number | null;
}

export interface ChaptersResponse {
    chapters: Chapter[];
}

export interface ChapterResponse {
    chapter: Chapter;
}

/** Body accepted by `POST /api/audits/daily`. `actualMin` is optional (Req 14.1–14.3). */
export interface DailyAuditInput {
    /** UTC calendar day to record, as `YYYY-MM-DD`. */
    date: string;
    plannedMin: number;
    actualMin?: number;
}

/** The persisted Daily_Time_Audit echoed back by `POST /api/audits/daily`. */
export interface DailyAudit {
    id: string;
    date: string;
    plannedMin: number;
    /** Derived from that day's focus sessions when present, else the user-entered value. */
    actualMin: number;
}

export interface DailyAuditResponse {
    audit: DailyAudit;
}

/** Whether the projection is ahead of or behind the Target_Completion_Date (Req 14.8). */
export type VelocityStatus = 'AHEAD' | 'BEHIND';

/** Response of `GET /api/velocity`. Dates are ISO-8601 strings; `null` when indefinite. */
export interface VelocityResponse {
    projectedCompletionDate: string | null;
    targetCompletionDate: string;
    deltaDays: number | null;
    status: VelocityStatus;
}

/** `GET /api/dashboard` — per-subject hours, streak, and syllabus completion. */
export function getDashboard(): Promise<DashboardResponse> {
    return request<DashboardResponse>('/dashboard');
}

/** `GET /api/chapters` — the user's chapters with status. */
export function getChapters(): Promise<ChaptersResponse> {
    return request<ChaptersResponse>('/chapters');
}

/**
 * `PATCH /api/chapters/:id/status` — advance a chapter's status. The server rejects a
 * backward/illegal move with `422 ILLEGAL_STATUS_TRANSITION` (Req 12.1).
 */
export function updateChapterStatus(
    chapterId: string,
    status: ChapterStatus,
): Promise<ChapterResponse> {
    return request<ChapterResponse>(`/chapters/${chapterId}/status`, {
        method: 'PATCH',
        body: { status },
    });
}

/** `POST /api/audits/daily` — record the day's planned vs actual study time (Req 14.1). */
export function postDailyAudit(input: DailyAuditInput): Promise<DailyAuditResponse> {
    return request<DailyAuditResponse>('/audits/daily', { method: 'POST', body: input });
}

/** `GET /api/velocity` — AHEAD/BEHIND vs target completion date with the day delta (Req 14.8). */
export function getVelocity(): Promise<VelocityResponse> {
    return request<VelocityResponse>('/velocity');
}
