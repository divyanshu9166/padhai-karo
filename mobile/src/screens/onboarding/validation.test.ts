/**
 * Unit tests for the pure onboarding validation helpers (task 21.2).
 *
 * Covers the two semantic boundaries the screen pre-checks before submitting to
 * `POST /onboarding`: target year ≥ current year (Req 2.2) and commitment end > start
 * (Req 2.3), plus the Req 2.9 allowance for an empty peak-focus-window set.
 */
import type { OnboardingPayload } from './onboardingApi';
import {
    isEndAfterStart,
    isTargetYearValid,
    parseHHmm,
    validateCommitment,
    validateOnboarding,
} from './validation';

const CURRENT_YEAR = 2025;

function basePayload(overrides: Partial<OnboardingPayload> = {}): OnboardingPayload {
    return {
        examTrack: 'JEE',
        targetYear: CURRENT_YEAR + 1,
        currentClass: 'Class 12',
        fixedCommitments: [],
        peakFocusWindows: [],
        ...overrides,
    };
}

describe('parseHHmm', () => {
    it('parses valid 24-hour times to minutes-since-midnight', () => {
        expect(parseHHmm('00:00')).toBe(0);
        expect(parseHHmm('09:30')).toBe(570);
        expect(parseHHmm('23:59')).toBe(1439);
    });

    it('rejects malformed times', () => {
        expect(parseHHmm('24:00')).toBeNull();
        expect(parseHHmm('9:30')).toBeNull();
        expect(parseHHmm('12:60')).toBeNull();
        expect(parseHHmm('noon')).toBeNull();
        expect(parseHHmm('')).toBeNull();
    });
});

describe('isEndAfterStart (Req 2.3)', () => {
    it('accepts end strictly later than start', () => {
        expect(isEndAfterStart('09:00', '10:00')).toBe(true);
    });

    it('rejects equal or earlier end, and malformed times', () => {
        expect(isEndAfterStart('10:00', '10:00')).toBe(false);
        expect(isEndAfterStart('10:00', '09:00')).toBe(false);
        expect(isEndAfterStart('bad', '10:00')).toBe(false);
    });
});

describe('isTargetYearValid (Req 2.2)', () => {
    it('accepts the current year and later', () => {
        expect(isTargetYearValid(CURRENT_YEAR, CURRENT_YEAR)).toBe(true);
        expect(isTargetYearValid(CURRENT_YEAR + 2, CURRENT_YEAR)).toBe(true);
    });

    it('rejects earlier years and non-integers', () => {
        expect(isTargetYearValid(CURRENT_YEAR - 1, CURRENT_YEAR)).toBe(false);
        expect(isTargetYearValid(2025.5, CURRENT_YEAR)).toBe(false);
    });
});

describe('validateCommitment (Req 2.3)', () => {
    it('returns null for a valid commitment', () => {
        expect(
            validateCommitment({ dayOfWeek: 1, startTime: '09:00', endTime: '11:00', label: 'School' }),
        ).toBeNull();
    });

    it('flags a missing label, bad times, and end ≤ start', () => {
        expect(
            validateCommitment({ dayOfWeek: 1, startTime: '09:00', endTime: '11:00', label: '  ' }),
        ).toMatch(/label/i);
        expect(
            validateCommitment({ dayOfWeek: 1, startTime: '9am', endTime: '11:00', label: 'School' }),
        ).toMatch(/HH:mm/i);
        expect(
            validateCommitment({ dayOfWeek: 1, startTime: '11:00', endTime: '09:00', label: 'School' }),
        ).toMatch(/later than/i);
    });
});

describe('validateOnboarding', () => {
    it('accepts a valid payload with no commitments and no peak windows (Req 2.9)', () => {
        expect(validateOnboarding(basePayload(), CURRENT_YEAR)).toBeNull();
    });

    it('requires a current class', () => {
        expect(validateOnboarding(basePayload({ currentClass: '   ' }), CURRENT_YEAR)).toMatch(
            /current class/i,
        );
    });

    it('rejects a target year earlier than the current year (Req 2.2)', () => {
        expect(
            validateOnboarding(basePayload({ targetYear: CURRENT_YEAR - 1 }), CURRENT_YEAR),
        ).toMatch(/Target year/i);
    });

    it('rejects a commitment whose end is not later than its start (Req 2.3)', () => {
        const payload = basePayload({
            fixedCommitments: [
                { dayOfWeek: 1, startTime: '10:00', endTime: '10:00', label: 'School' },
            ],
        });
        expect(validateOnboarding(payload, CURRENT_YEAR)).toMatch(/later than/i);
    });
});
