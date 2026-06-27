/**
 * Pure client-side onboarding validation (task 21.2, Req 2.2 / 2.3).
 *
 * Mirrors the two semantic boundaries the Backend_API enforces so the user gets immediate
 * feedback before submitting — the server remains the source of truth and re-validates:
 *
 *   - target year must not be earlier than the current calendar year (Req 2.2);
 *   - every fixed commitment's end time must be strictly later than its start time, and both
 *     must be well-formed "HH:mm" values (Req 2.3).
 *
 * Framework/clock-free so it can be unit-tested in isolation; `currentYear` is injected.
 */
import type { FixedCommitmentInput, OnboardingPayload } from './onboardingApi';

/** Matches a 24-hour "HH:mm" time string (00:00–23:59). */
const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parse "HH:mm" into minutes-since-midnight, or `null` when malformed. */
export function parseHHmm(value: string): number | null {
    const match = HH_MM_PATTERN.exec(value);
    if (!match) return null;
    return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

/** True when `endTime` is a valid time strictly later than a valid `startTime` (Req 2.3). */
export function isEndAfterStart(startTime: string, endTime: string): boolean {
    const start = parseHHmm(startTime);
    const end = parseHHmm(endTime);
    if (start === null || end === null) return false;
    return end > start;
}

/** True when `targetYear` is an integer at or after `currentYear` (Req 2.2). */
export function isTargetYearValid(targetYear: number, currentYear: number): boolean {
    return Number.isInteger(targetYear) && targetYear >= currentYear;
}

/** Validate a single commitment's fields; returns an error string or `null` when valid. */
export function validateCommitment(commitment: FixedCommitmentInput): string | null {
    if (commitment.label.trim().length === 0) {
        return 'Each commitment needs a label.';
    }
    if (parseHHmm(commitment.startTime) === null || parseHHmm(commitment.endTime) === null) {
        return 'Commitment times must be in HH:mm format (e.g. 09:30).';
    }
    if (!isEndAfterStart(commitment.startTime, commitment.endTime)) {
        return 'Commitment end time must be later than its start time.';
    }
    return null;
}

/**
 * Validate the whole onboarding payload. Returns the first user-facing error message, or
 * `null` when the payload is ready to submit. Peak focus windows are intentionally not
 * required — an empty set is valid (Req 2.9).
 */
export function validateOnboarding(
    payload: OnboardingPayload,
    currentYear: number,
): string | null {
    if (payload.currentClass.trim().length === 0) {
        return 'Enter your current class.';
    }
    if (!isTargetYearValid(payload.targetYear, currentYear)) {
        return `Target year must not be earlier than ${currentYear}.`;
    }
    for (const commitment of payload.fixedCommitments) {
        const err = validateCommitment(commitment);
        if (err) return err;
    }
    return null;
}
