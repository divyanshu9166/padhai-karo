import { describe, expect, it } from 'vitest';

import {
    LANGUAGE_PREF_VALUES,
    validateFixedCommitmentInput,
    validateLanguageInput,
    validatePeakWindowsInput,
} from './profileValidation';

/**
 * DB-independent unit tests for the Profile Service validation logic (task 4.2). These
 * exercise the pure validators directly — no server, clock, or database needed — covering
 * the supported Language_Preference values (Req 10.1), Peak_Focus_Window values + de-dupe
 * (Req 2.8), and the fixed-commitment end>start boundary (Req 2.3).
 *
 * Validates: Requirements 2.3, 2.8, 10.1
 */

describe('validateLanguageInput (Req 10.1)', () => {
    it.each([...LANGUAGE_PREF_VALUES])('accepts supported language %s', (language) => {
        const result = validateLanguageInput({ language });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toBe(language);
        }
    });

    it.each(['en', 'hi', 'FR', '', 'ENGLISH'])('rejects unsupported language %j', (language) => {
        const result = validateLanguageInput({ language });
        expect(result.ok).toBe(false);
    });

    it.each([null, undefined, 42, 'EN', []])('rejects a non-object body %j', (body) => {
        const result = validateLanguageInput(body);
        expect(result.ok).toBe(false);
    });

    it('rejects a missing language field', () => {
        expect(validateLanguageInput({}).ok).toBe(false);
    });
});

describe('validatePeakWindowsInput (Req 2.8)', () => {
    it('accepts a valid set of windows', () => {
        const result = validatePeakWindowsInput({ windows: ['MORNING', 'NIGHT'] });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual(['MORNING', 'NIGHT']);
        }
    });

    it('accepts an empty array (clears all high-energy bands, Req 2.9)', () => {
        const result = validatePeakWindowsInput({ windows: [] });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual([]);
        }
    });

    it('de-duplicates repeated windows preserving first-seen order', () => {
        const result = validatePeakWindowsInput({
            windows: ['NIGHT', 'MORNING', 'NIGHT', 'AFTERNOON', 'MORNING'],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual(['NIGHT', 'MORNING', 'AFTERNOON']);
        }
    });

    it.each(['EVENING', 'morning', '', 'DAWN'])('rejects an unknown window %j', (window) => {
        const result = validatePeakWindowsInput({ windows: [window] });
        expect(result.ok).toBe(false);
    });

    it('rejects a non-array windows field', () => {
        expect(validatePeakWindowsInput({ windows: 'MORNING' }).ok).toBe(false);
    });

    it.each([null, undefined, 42, []])('rejects a non-object body %j', (body) => {
        expect(validatePeakWindowsInput(body).ok).toBe(false);
    });
});

describe('validateFixedCommitmentInput (Req 2.1, 2.3)', () => {
    const valid = { dayOfWeek: 1, startTime: '08:00', endTime: '14:00', label: 'School' };

    it('accepts a well-formed commitment and trims the label', () => {
        const result = validateFixedCommitmentInput({ ...valid, label: '  School  ' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual(valid);
        }
    });

    it('rejects a commitment whose end equals its start (Req 2.3)', () => {
        const result = validateFixedCommitmentInput({ ...valid, startTime: '08:00', endTime: '08:00' });
        expect(result.ok).toBe(false);
    });

    it('rejects a commitment whose end is before its start (Req 2.3)', () => {
        const result = validateFixedCommitmentInput({ ...valid, startTime: '14:00', endTime: '08:00' });
        expect(result.ok).toBe(false);
    });

    it.each([-1, 7, 1.5, '1'])('rejects an out-of-range/invalid dayOfWeek %j', (dayOfWeek) => {
        const result = validateFixedCommitmentInput({ ...valid, dayOfWeek });
        expect(result.ok).toBe(false);
    });

    it.each(['8:00', '24:00', '08:60', '', 'noon'])('rejects a malformed startTime %j', (startTime) => {
        const result = validateFixedCommitmentInput({ ...valid, startTime });
        expect(result.ok).toBe(false);
    });

    it.each(['8:00', '24:00', '', 'midnight'])('rejects a malformed endTime %j', (endTime) => {
        const result = validateFixedCommitmentInput({ ...valid, endTime });
        expect(result.ok).toBe(false);
    });

    it.each(['', '   '])('rejects a blank label %j', (label) => {
        const result = validateFixedCommitmentInput({ ...valid, label });
        expect(result.ok).toBe(false);
    });

    it.each([null, undefined, 42, []])('rejects a non-object body %j', (body) => {
        expect(validateFixedCommitmentInput(body).ok).toBe(false);
    });
});
