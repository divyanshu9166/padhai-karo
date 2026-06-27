/**
 * Pure validation for the Profile Service (task 4.2; design "Onboarding / Profile Service").
 *
 * This module holds the framework- and database-free decision logic for the profile
 * mutation endpoints so it can be unit-tested in isolation (no live DB required) and reused
 * by the thin route handlers. It deliberately reuses the onboarding validation primitives
 * ({@link isEndAfterStart}, {@link parseHHmm}, {@link PEAK_FOCUS_WINDOW_VALUES}) so the
 * profile endpoints validate fixed commitments and peak focus windows consistently with
 * onboarding (Req 2.3, 2.8):
 *
 *   - {@link validateLanguageInput} accepts only the supported Language_Preference values
 *     `EN` / `HI` (Req 10.1).
 *   - {@link validatePeakWindowsInput} accepts an array of Peak_Focus_Window values, each
 *     one of `MORNING` / `AFTERNOON` / `NIGHT`, and de-dupes the result (Req 2.8).
 *   - {@link validateFixedCommitmentInput} validates a single fixed commitment, rejecting
 *     any whose end time is not later than its start time (Req 2.3).
 *
 * All validators are pure: they perform no I/O and never touch the database, so the route
 * handlers own persistence and per-user scoping.
 */
import {
    PEAK_FOCUS_WINDOW_VALUES,
    isEndAfterStart,
    parseHHmm,
} from '@/services/onboarding';
import type { FixedCommitmentInput, PeakFocusWindow } from '@/services/onboarding';

/** The supported Language_Preference values (mirrors the Prisma `LanguagePref` enum, Req 10.1). */
export const LANGUAGE_PREF_VALUES = ['EN', 'HI'] as const;

/** A supported interface language. */
export type LanguagePref = (typeof LANGUAGE_PREF_VALUES)[number];

/**
 * Discriminated validation result: either the parsed value or a ready-to-serialize
 * validation error (developer-facing `message` and optional structured `details`).
 */
export type ProfileValidation<T> =
    | { ok: true; value: T }
    | { ok: false; message: string; details?: unknown };

/** Type guard: a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a `PATCH /profile/language` payload (Req 10.1). The body must be an object with
 * a `language` field equal to one of {@link LANGUAGE_PREF_VALUES}; anything else is a
 * validation error.
 */
export function validateLanguageInput(raw: unknown): ProfileValidation<LanguagePref> {
    if (!isObject(raw)) {
        return { ok: false, message: 'Request body must be a JSON object.' };
    }
    const { language } = raw;
    if (
        typeof language !== 'string' ||
        !(LANGUAGE_PREF_VALUES as readonly string[]).includes(language)
    ) {
        return {
            ok: false,
            message: `"language" must be one of: ${LANGUAGE_PREF_VALUES.join(', ')}.`,
            details: { field: 'language', allowed: LANGUAGE_PREF_VALUES },
        };
    }
    return { ok: true, value: language as LanguagePref };
}

/**
 * Validate a `PATCH /profile/peak-windows` payload (Req 2.8). The body must be an object
 * with a `windows` array; each entry must be one of {@link PEAK_FOCUS_WINDOW_VALUES}. The
 * returned set is de-duplicated (preserving first-seen order) so the stored value is a
 * clean set of windows. An empty array is permitted (clears all high-energy bands, Req 2.9).
 */
export function validatePeakWindowsInput(raw: unknown): ProfileValidation<PeakFocusWindow[]> {
    if (!isObject(raw)) {
        return { ok: false, message: 'Request body must be a JSON object.' };
    }
    const { windows } = raw;
    if (!Array.isArray(windows)) {
        return {
            ok: false,
            message: '"windows" must be an array.',
            details: { field: 'windows' },
        };
    }
    const validated: PeakFocusWindow[] = [];
    for (let i = 0; i < windows.length; i += 1) {
        const window = windows[i];
        if (
            typeof window !== 'string' ||
            !(PEAK_FOCUS_WINDOW_VALUES as readonly string[]).includes(window)
        ) {
            return {
                ok: false,
                message: `"windows[${i}]" must be one of: ${PEAK_FOCUS_WINDOW_VALUES.join(', ')}.`,
                details: { index: i, allowed: PEAK_FOCUS_WINDOW_VALUES },
            };
        }
        if (!validated.includes(window as PeakFocusWindow)) {
            validated.push(window as PeakFocusWindow);
        }
    }
    return { ok: true, value: validated };
}

/**
 * Validate a `POST /profile/fixed-commitments` payload (Req 2.1, 2.3). The body must be an
 * object carrying a `dayOfWeek` (integer 0–6), a `startTime` and `endTime` as well-formed
 * "HH:mm" times, and a non-blank `label`. The commitment is rejected when its end time is
 * not strictly later than its start time (Req 2.3).
 */
export function validateFixedCommitmentInput(
    raw: unknown,
): ProfileValidation<FixedCommitmentInput> {
    if (!isObject(raw)) {
        return { ok: false, message: 'Request body must be a JSON object.' };
    }
    const { dayOfWeek, startTime, endTime, label } = raw;

    if (
        typeof dayOfWeek !== 'number' ||
        !Number.isInteger(dayOfWeek) ||
        dayOfWeek < 0 ||
        dayOfWeek > 6
    ) {
        return {
            ok: false,
            message: '"dayOfWeek" must be an integer from 0 to 6.',
            details: { field: 'dayOfWeek' },
        };
    }
    if (typeof startTime !== 'string' || parseHHmm(startTime) === null) {
        return {
            ok: false,
            message: '"startTime" must be a valid "HH:mm" time.',
            details: { field: 'startTime' },
        };
    }
    if (typeof endTime !== 'string' || parseHHmm(endTime) === null) {
        return {
            ok: false,
            message: '"endTime" must be a valid "HH:mm" time.',
            details: { field: 'endTime' },
        };
    }
    if (typeof label !== 'string' || label.trim() === '') {
        return {
            ok: false,
            message: '"label" is required.',
            details: { field: 'label' },
        };
    }
    // Req 2.3: reject any commitment whose end time is not later than its start time.
    if (!isEndAfterStart(startTime, endTime)) {
        return {
            ok: false,
            message: 'Commitment end time must be later than its start time.',
            details: { startTime, endTime },
        };
    }

    return {
        ok: true,
        value: { dayOfWeek, startTime, endTime, label: label.trim() },
    };
}
