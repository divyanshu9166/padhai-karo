import { describe, expect, it } from 'vitest';

import {
    EXAM_TRACK_VALUES,
    isEndAfterStart,
    isTargetYearValid,
    parseHHmm,
    toChapterCreateInputs,
    validateOnboardingInput,
} from './validation';
import { getChapters, getSubjects } from '@/lib/reference';
import type { ExamTrack } from '@/lib/reference';

/**
 * DB-independent unit tests for the onboarding validation + reference-mapping logic
 * (task 4.1). These exercise the pure functions directly — no server, clock, or database
 * needed — covering the two validation boundaries (Req 2.2 target year, Req 2.3 commitment
 * start/end) and the catalog → per-user Chapter mapping (Req 2.4, 2.7, 12.6).
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.7, 2.9, 12.6
 */

const CURRENT_YEAR = 2026;

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        examTrack: 'JEE',
        targetYear: CURRENT_YEAR + 1,
        currentClass: 'Class 12',
        fixedCommitments: [
            { dayOfWeek: 1, startTime: '08:00', endTime: '14:00', label: 'School' },
        ],
        peakFocusWindows: ['MORNING'],
        ...overrides,
    };
}

describe('parseHHmm', () => {
    it('parses valid 24-hour times to minutes since midnight', () => {
        expect(parseHHmm('00:00')).toBe(0);
        expect(parseHHmm('08:30')).toBe(8 * 60 + 30);
        expect(parseHHmm('23:59')).toBe(23 * 60 + 59);
    });

    it.each(['24:00', '08:60', '8:00', '0800', '', 'ab:cd', '23:5'])(
        'rejects malformed time %j',
        (value) => {
            expect(parseHHmm(value)).toBeNull();
        },
    );
});

describe('isEndAfterStart (Req 2.3)', () => {
    it('accepts end strictly later than start', () => {
        expect(isEndAfterStart('08:00', '09:00')).toBe(true);
        expect(isEndAfterStart('08:00', '08:01')).toBe(true);
    });

    it('rejects end equal to start', () => {
        expect(isEndAfterStart('08:00', '08:00')).toBe(false);
    });

    it('rejects end earlier than start', () => {
        expect(isEndAfterStart('09:00', '08:00')).toBe(false);
    });

    it('rejects malformed times', () => {
        expect(isEndAfterStart('bad', '09:00')).toBe(false);
        expect(isEndAfterStart('08:00', 'bad')).toBe(false);
    });
});

describe('isTargetYearValid (Req 2.2)', () => {
    it('accepts the current year and later', () => {
        expect(isTargetYearValid(CURRENT_YEAR, CURRENT_YEAR)).toBe(true);
        expect(isTargetYearValid(CURRENT_YEAR + 5, CURRENT_YEAR)).toBe(true);
    });

    it('rejects a year earlier than the current calendar year', () => {
        expect(isTargetYearValid(CURRENT_YEAR - 1, CURRENT_YEAR)).toBe(false);
    });
});

describe('validateOnboardingInput', () => {
    it('accepts a well-formed payload and normalizes it', () => {
        const result = validateOnboardingInput(validPayload(), CURRENT_YEAR);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.examTrack).toBe('JEE');
            expect(result.value.targetYear).toBe(CURRENT_YEAR + 1);
            expect(result.value.currentClass).toBe('Class 12');
            expect(result.value.fixedCommitments).toHaveLength(1);
            expect(result.value.peakFocusWindows).toEqual(['MORNING']);
        }
    });

    it('rejects a target year earlier than the current calendar year (Req 2.2)', () => {
        const result = validateOnboardingInput(
            validPayload({ targetYear: CURRENT_YEAR - 1 }),
            CURRENT_YEAR,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('VALIDATION_ERROR');
        }
    });

    it('accepts a target year equal to the current calendar year (boundary, Req 2.2)', () => {
        const result = validateOnboardingInput(
            validPayload({ targetYear: CURRENT_YEAR }),
            CURRENT_YEAR,
        );
        expect(result.ok).toBe(true);
    });

    it('rejects a commitment whose end equals its start (Req 2.3)', () => {
        const result = validateOnboardingInput(
            validPayload({
                fixedCommitments: [
                    { dayOfWeek: 1, startTime: '08:00', endTime: '08:00', label: 'School' },
                ],
            }),
            CURRENT_YEAR,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('VALIDATION_ERROR');
        }
    });

    it('rejects a commitment whose end is before its start (Req 2.3)', () => {
        const result = validateOnboardingInput(
            validPayload({
                fixedCommitments: [
                    { dayOfWeek: 1, startTime: '14:00', endTime: '08:00', label: 'School' },
                ],
            }),
            CURRENT_YEAR,
        );
        expect(result.ok).toBe(false);
    });

    it.each([...EXAM_TRACK_VALUES])('accepts exam track %s', (track) => {
        const result = validateOnboardingInput(validPayload({ examTrack: track }), CURRENT_YEAR);
        expect(result.ok).toBe(true);
    });

    it('rejects an unknown exam track', () => {
        const result = validateOnboardingInput(validPayload({ examTrack: 'SAT' }), CURRENT_YEAR);
        expect(result.ok).toBe(false);
    });

    it('allows omitted fixed commitments (defaults to empty)', () => {
        const payload = validPayload();
        delete payload.fixedCommitments;
        const result = validateOnboardingInput(payload, CURRENT_YEAR);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.fixedCommitments).toEqual([]);
        }
    });

    it('allows an empty peak-focus-window set (Req 2.9)', () => {
        const result = validateOnboardingInput(
            validPayload({ peakFocusWindows: [] }),
            CURRENT_YEAR,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.peakFocusWindows).toEqual([]);
        }
    });

    it('allows omitted peak-focus-windows (defaults to empty, Req 2.9)', () => {
        const payload = validPayload();
        delete payload.peakFocusWindows;
        const result = validateOnboardingInput(payload, CURRENT_YEAR);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.peakFocusWindows).toEqual([]);
        }
    });

    it('de-duplicates repeated peak focus windows', () => {
        const result = validateOnboardingInput(
            validPayload({ peakFocusWindows: ['MORNING', 'MORNING', 'NIGHT'] }),
            CURRENT_YEAR,
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.peakFocusWindows).toEqual(['MORNING', 'NIGHT']);
        }
    });

    it('rejects an unknown peak focus window', () => {
        const result = validateOnboardingInput(
            validPayload({ peakFocusWindows: ['EVENING'] }),
            CURRENT_YEAR,
        );
        expect(result.ok).toBe(false);
    });

    it('rejects an empty current class', () => {
        const result = validateOnboardingInput(validPayload({ currentClass: '   ' }), CURRENT_YEAR);
        expect(result.ok).toBe(false);
    });

    it.each([null, 42, 'string', []])('rejects a non-object body %j', (body) => {
        const result = validateOnboardingInput(body, CURRENT_YEAR);
        expect(result.ok).toBe(false);
    });

    it('rejects a commitment with an out-of-range dayOfWeek', () => {
        const result = validateOnboardingInput(
            validPayload({
                fixedCommitments: [
                    { dayOfWeek: 7, startTime: '08:00', endTime: '09:00', label: 'School' },
                ],
            }),
            CURRENT_YEAR,
        );
        expect(result.ok).toBe(false);
    });
});

describe('toChapterCreateInputs (Req 2.4, 2.7, 12.6)', () => {
    it.each([...EXAM_TRACK_VALUES])(
        'maps every catalog chapter for track %s to a NOT_STARTED per-user chapter',
        (track) => {
            const userId = 'user-123';
            const inputs = toChapterCreateInputs(track as ExamTrack, userId);
            const catalog = getChapters(track as ExamTrack);

            expect(inputs).toHaveLength(catalog.length);

            // Every chapter is scoped to the user, starts NOT_STARTED, and carries weightage
            // + estimated study hours (Req 2.7, 12.6).
            for (const chapter of inputs) {
                expect(chapter.userId).toBe(userId);
                expect(chapter.status).toBe('NOT_STARTED');
                expect(chapter.weightage).toBeGreaterThan(0);
                expect(chapter.estimatedStudyHours).toBeGreaterThan(0);
                expect(chapter.weightageIsDefault).toBe(false);
                expect(['HARD', 'LIGHT']).toContain(chapter.taskDifficulty);
            }

            // referenceKey/name/subjectId are copied from the catalog (Req 2.7).
            const byKey = new Map(inputs.map((c) => [c.referenceKey, c]));
            for (const ref of catalog) {
                const mapped = byKey.get(ref.referenceKey);
                expect(mapped).toBeDefined();
                expect(mapped?.name).toBe(ref.name);
                expect(mapped?.subjectId).toBe(ref.subjectKey);
                expect(mapped?.weightage).toBe(ref.weightage);
                expect(mapped?.estimatedStudyHours).toBe(ref.estimatedStudyHours);
            }
        },
    );

    it('associates chapters only with subjects of the selected track (Req 2.4)', () => {
        const inputs = toChapterCreateInputs('NEET', 'user-x');
        const subjectKeys = new Set(getSubjects('NEET').map((s) => s.key));
        expect(inputs.every((c) => subjectKeys.has(c.subjectId))).toBe(true);
    });
});
