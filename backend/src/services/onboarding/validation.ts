/**
 * Pure onboarding validation and reference-mapping logic (task 4.1, Req 2).
 *
 * This module is deliberately free of any framework, database, or clock dependency so it
 * can be unit-tested in isolation and reused by the onboarding service
 * (`./onboardingService`). It covers the two validation boundaries from Req 2.2 / 2.3 and
 * the catalog → per-user `Chapter` mapping from Req 2.4 / 2.7:
 *
 *   - {@link validateOnboardingInput} shape-checks and validates an onboarding payload,
 *     rejecting a target year earlier than the (caller-supplied) current calendar year
 *     (Req 2.2) and any fixed commitment whose end time is not later than its start time
 *     (Req 2.3). Both yield a `VALIDATION_ERROR`.
 *   - {@link toChapterCreateInputs} expands the seeded reference catalog for an exam track
 *     into the per-user `Chapter` rows onboarding persists, each initialized to
 *     `NOT_STARTED` and carrying its weightage, estimated study hours, and task difficulty
 *     (Req 2.7, 12.6).
 *
 * The "current year" is injected rather than read from the system clock so the boundary
 * in Req 2.2 is deterministic and testable.
 */
import { ErrorCode } from '@/lib/errors';
import { getChapters } from '@/lib/reference';
import type { ExamTrack, TaskDifficulty } from '@/lib/reference';

/** The exam tracks accepted at onboarding (mirrors the Prisma `ExamTrack` enum). */
export const EXAM_TRACK_VALUES = ['JEE', 'NEET'] as const;

/** Valid Peak_Focus_Window values (mirrors the Prisma `PeakFocusWindow` enum, Req 2.8). */
export const PEAK_FOCUS_WINDOW_VALUES = ['MORNING', 'AFTERNOON', 'NIGHT'] as const;

/** A Peak_Focus_Window the user can mark as a high-energy band. */
export type PeakFocusWindow = (typeof PEAK_FOCUS_WINDOW_VALUES)[number];

/** A single recurring unavailable block supplied during onboarding (Req 2.1, 2.3). */
export interface FixedCommitmentInput {
    /** Day of week, 0 (Sunday) – 6 (Saturday). */
    dayOfWeek: number;
    /** Local start time as "HH:mm" (24-hour). */
    startTime: string;
    /** Local end time as "HH:mm" (24-hour); must be strictly later than `startTime`. */
    endTime: string;
    /** Human-readable label (e.g. "School", "Coaching"). */
    label: string;
}

/** A fully validated onboarding payload. */
export interface OnboardingInput {
    examTrack: ExamTrack;
    targetYear: number;
    currentClass: string;
    fixedCommitments: FixedCommitmentInput[];
    peakFocusWindows: PeakFocusWindow[];
}

/**
 * Outcome of validating a raw onboarding payload: either the parsed {@link OnboardingInput}
 * or a ready-to-serialize validation error (stable `code`, developer-facing `message`, and
 * optional structured `details`).
 */
export type OnboardingValidation =
    | { ok: true; value: OnboardingInput }
    | { ok: false; code: string; message: string; details?: unknown };

/** A per-user `Chapter` row to create, derived from the reference catalog (Req 2.7). */
export interface ChapterCreateInput {
    userId: string;
    subjectId: string;
    referenceKey: string;
    name: string;
    status: 'NOT_STARTED';
    weightage: number;
    weightageIsDefault: boolean;
    estimatedStudyHours: number;
    taskDifficulty: TaskDifficulty;
}

/** Matches a 24-hour "HH:mm" time string (00:00–23:59). */
const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parse an "HH:mm" 24-hour time into minutes-since-midnight, or `null` when the string is
 * not a well-formed time. Used to compare commitment start/end times (Req 2.3).
 */
export function parseHHmm(value: string): number | null {
    const match = HH_MM_PATTERN.exec(value);
    if (!match) {
        return null;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    return hours * 60 + minutes;
}

/**
 * True when `endTime` is strictly later than `startTime` (both "HH:mm"). Returns `false`
 * when either string is malformed or when end ≤ start — the rejection condition in Req 2.3.
 */
export function isEndAfterStart(startTime: string, endTime: string): boolean {
    const start = parseHHmm(startTime);
    const end = parseHHmm(endTime);
    if (start === null || end === null) {
        return false;
    }
    return end > start;
}

/**
 * True when `targetYear` is at or after `currentYear`. A year earlier than the current
 * calendar year is rejected (Req 2.2).
 */
export function isTargetYearValid(targetYear: number, currentYear: number): boolean {
    return Number.isInteger(targetYear) && targetYear >= currentYear;
}

/** Type guard: a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(message: string, details?: unknown): OnboardingValidation {
    return { ok: false, code: ErrorCode.VALIDATION_ERROR, message, details };
}

/**
 * Validate a raw onboarding payload against Req 2.1–2.3, 2.8, 2.9.
 *
 * Shape errors (missing/mistyped fields, unknown enum values) and the two semantic
 * boundaries — target year < current year (Req 2.2) and a fixed commitment with
 * end ≤ start (Req 2.3) — all surface as a `VALIDATION_ERROR`. An empty
 * `peakFocusWindows` array is allowed and preserved (Req 2.9); the field may also be
 * omitted entirely, in which case it defaults to empty.
 *
 * @param raw - the parsed request body (untrusted).
 * @param currentYear - the current calendar year, injected for deterministic testing.
 */
export function validateOnboardingInput(
    raw: unknown,
    currentYear: number,
): OnboardingValidation {
    if (!isObject(raw)) {
        return validationError('Onboarding payload must be a JSON object.');
    }

    const { examTrack, targetYear, currentClass, fixedCommitments, peakFocusWindows } = raw;

    // Exam track (Req 2.1, 2.4).
    if (typeof examTrack !== 'string' || !(EXAM_TRACK_VALUES as readonly string[]).includes(examTrack)) {
        return validationError(`"examTrack" must be one of: ${EXAM_TRACK_VALUES.join(', ')}.`, {
            field: 'examTrack',
            allowed: EXAM_TRACK_VALUES,
        });
    }

    // Target year (Req 2.1, 2.2).
    if (typeof targetYear !== 'number' || !Number.isInteger(targetYear)) {
        return validationError('"targetYear" must be an integer.', { field: 'targetYear' });
    }
    if (!isTargetYearValid(targetYear, currentYear)) {
        return validationError(
            `"targetYear" must not be earlier than the current calendar year (${currentYear}).`,
            { field: 'targetYear', value: targetYear, currentYear },
        );
    }

    // Current class (Req 2.1).
    if (typeof currentClass !== 'string' || currentClass.trim() === '') {
        return validationError('"currentClass" is required.', { field: 'currentClass' });
    }

    // Fixed commitments (Req 2.1, 2.3). Omitted => empty set.
    const fixedCommitmentsRaw = fixedCommitments ?? [];
    if (!Array.isArray(fixedCommitmentsRaw)) {
        return validationError('"fixedCommitments" must be an array.', {
            field: 'fixedCommitments',
        });
    }
    const validatedCommitments: FixedCommitmentInput[] = [];
    for (let i = 0; i < fixedCommitmentsRaw.length; i += 1) {
        const entry = fixedCommitmentsRaw[i];
        if (!isObject(entry)) {
            return validationError(`"fixedCommitments[${i}]" must be an object.`, { index: i });
        }
        const { dayOfWeek, startTime, endTime, label } = entry;
        if (typeof dayOfWeek !== 'number' || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
            return validationError(
                `"fixedCommitments[${i}].dayOfWeek" must be an integer from 0 to 6.`,
                { index: i, field: 'dayOfWeek' },
            );
        }
        if (typeof startTime !== 'string' || parseHHmm(startTime) === null) {
            return validationError(
                `"fixedCommitments[${i}].startTime" must be a valid "HH:mm" time.`,
                { index: i, field: 'startTime' },
            );
        }
        if (typeof endTime !== 'string' || parseHHmm(endTime) === null) {
            return validationError(
                `"fixedCommitments[${i}].endTime" must be a valid "HH:mm" time.`,
                { index: i, field: 'endTime' },
            );
        }
        if (typeof label !== 'string' || label.trim() === '') {
            return validationError(`"fixedCommitments[${i}].label" is required.`, {
                index: i,
                field: 'label',
            });
        }
        // Req 2.3: reject any commitment whose end time is not later than its start time.
        if (!isEndAfterStart(startTime, endTime)) {
            return validationError(
                `"fixedCommitments[${i}]" end time must be later than its start time.`,
                { index: i, startTime, endTime },
            );
        }
        validatedCommitments.push({ dayOfWeek, startTime, endTime, label });
    }

    // Peak focus windows (Req 2.8, 2.9). Omitted or empty => no high-energy bands.
    const peakFocusWindowsRaw = peakFocusWindows ?? [];
    if (!Array.isArray(peakFocusWindowsRaw)) {
        return validationError('"peakFocusWindows" must be an array.', {
            field: 'peakFocusWindows',
        });
    }
    const validatedWindows: PeakFocusWindow[] = [];
    for (let i = 0; i < peakFocusWindowsRaw.length; i += 1) {
        const window = peakFocusWindowsRaw[i];
        if (typeof window !== 'string' || !(PEAK_FOCUS_WINDOW_VALUES as readonly string[]).includes(window)) {
            return validationError(
                `"peakFocusWindows[${i}]" must be one of: ${PEAK_FOCUS_WINDOW_VALUES.join(', ')}.`,
                { index: i, allowed: PEAK_FOCUS_WINDOW_VALUES },
            );
        }
        // De-duplicate so the stored set is a clean set of windows.
        if (!validatedWindows.includes(window as PeakFocusWindow)) {
            validatedWindows.push(window as PeakFocusWindow);
        }
    }

    return {
        ok: true,
        value: {
            examTrack: examTrack as ExamTrack,
            targetYear,
            currentClass: currentClass.trim(),
            fixedCommitments: validatedCommitments,
            peakFocusWindows: validatedWindows,
        },
    };
}

/**
 * Expand the seeded reference catalog for an exam track into the per-user `Chapter` rows
 * onboarding persists (Req 2.7, 2.4, 12.6).
 *
 * Each chapter is initialized to `NOT_STARTED` and copies its `referenceKey`, `name`,
 * `subjectId` (the catalog subject key, which is the seeded `Subject.id`), `weightage`,
 * `estimatedStudyHours`, and `taskDifficulty` from the catalog. `weightageIsDefault` is
 * `false` because every catalog chapter ships with a real weightage (the mean fallback of
 * Req 11.5 only applies when reference weightage is genuinely absent).
 */
export function toChapterCreateInputs(track: ExamTrack, userId: string): ChapterCreateInput[] {
    return getChapters(track).map((chapter) => ({
        userId,
        subjectId: chapter.subjectKey,
        referenceKey: chapter.referenceKey,
        name: chapter.name,
        status: 'NOT_STARTED',
        weightage: chapter.weightage,
        weightageIsDefault: false,
        estimatedStudyHours: chapter.estimatedStudyHours,
        taskDifficulty: chapter.taskDifficulty,
    }));
}
