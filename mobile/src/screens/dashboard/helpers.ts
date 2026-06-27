/**
 * Pure presentation helpers for the dashboard feature (task 21.5).
 *
 * Database- and React-free so they unit-test directly and keep the screen thin: minute
 * formatting for the per-subject/study-time rows, the forward-only chapter status order
 * (Req 12.1), human labels, and parsing the daily check-in numeric inputs (Req 14.1).
 */

import type { ChapterStatus } from './api';

/** The forward-only chapter lifecycle order (Req 12.1, 12.2). */
export const STATUS_ORDER: readonly ChapterStatus[] = [
    'NOT_STARTED',
    'IN_PROGRESS',
    'DONE',
    'REVISED',
];

/**
 * The next status along the forward-only lifecycle, or `null` when already at the end
 * (`REVISED`). Used to label/drive the single "advance" action the UI offers (Req 12.1).
 */
export function nextChapterStatus(status: ChapterStatus): ChapterStatus | null {
    const index = STATUS_ORDER.indexOf(status);
    if (index < 0 || index >= STATUS_ORDER.length - 1) {
        return null;
    }
    // Safe: index+1 is within bounds given the guard above.
    return STATUS_ORDER[index + 1] as ChapterStatus;
}

/** A chapter counts toward syllabus completion once it is Done or Revised (Req 12.4). */
export function isCompletedStatus(status: ChapterStatus): boolean {
    return status === 'DONE' || status === 'REVISED';
}

/** The localization catalog key for a chapter status label (Req 12.1, localized via `t()`). */
export function chapterStatusKey(status: ChapterStatus): string {
    switch (status) {
        case 'NOT_STARTED':
            return 'chapter.status.notStarted';
        case 'IN_PROGRESS':
            return 'chapter.status.inProgress';
        case 'DONE':
            return 'chapter.status.done';
        case 'REVISED':
            return 'chapter.status.revised';
        default:
            return status;
    }
}

/** Human-readable English label for a chapter status. Prefer `chapterStatusKey` + `t()` in UI. */
export function statusLabel(status: ChapterStatus): string {
    switch (status) {
        case 'NOT_STARTED':
            return 'Not started';
        case 'IN_PROGRESS':
            return 'In progress';
        case 'DONE':
            return 'Done';
        case 'REVISED':
            return 'Revised';
        default:
            return status;
    }
}

/**
 * Format a whole-minute duration as a compact `Xh Ym` / `Ym` string. Negative inputs are
 * clamped to zero; fractional minutes are rounded to the nearest minute for display.
 */
export function formatMinutes(totalMin: number): string {
    const safe = Number.isFinite(totalMin) ? Math.max(0, Math.round(totalMin)) : 0;
    const hours = Math.floor(safe / 60);
    const minutes = safe % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

/** Sum the focused minutes across a list of per-subject totals. */
export function sumFocusedMinutes(rows: readonly { focusedDurationMin: number }[]): number {
    return rows.reduce((total, row) => total + (row.focusedDurationMin || 0), 0);
}

/**
 * Parse a user-entered minutes field to a non-negative integer, or `null` when the text is
 * not a valid count. An empty/whitespace string yields `null` (treated as "not provided").
 */
export function parseMinutesInput(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return null;
    }
    if (!/^\d+$/.test(trimmed)) {
        return null;
    }
    return Number.parseInt(trimmed, 10);
}

/** Today's UTC calendar day as `YYYY-MM-DD`, matching the server's audit day convention. */
export function todayUtcDateString(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** Format an ISO-8601 date string as `YYYY-MM-DD`, or a dash when absent/invalid. */
export function formatIsoDate(iso: string | null): string {
    if (!iso) {
        return '—';
    }
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return '—';
    }
    return parsed.toISOString().slice(0, 10);
}
