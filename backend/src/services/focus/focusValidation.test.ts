/**
 * Unit tests for the pure focus-session validation logic (task 8.1; Req 4.3, 4.5, 4.7, 4.8).
 *
 * These are DB-independent example/edge-case tests for the decision logic only. The
 * numbered property tests for duration validity (Property 21, task 8.3) and session-type
 * default (Property 22, task 8.4) are separate tasks and are not implemented here.
 */
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SESSION_TYPE,
    elapsedWallClockMinutes,
    resolveSessionType,
    validateFocusSessionInput,
} from './focusValidation';

const start = '2026-01-01T10:00:00.000Z';
const endPlus60 = '2026-01-01T11:00:00.000Z'; // 60 wall-clock minutes after start

describe('elapsedWallClockMinutes', () => {
    it('computes the exact minute span between start and end', () => {
        expect(elapsedWallClockMinutes(new Date(start), new Date(endPlus60))).toBe(60);
    });

    it('returns a fractional value for sub-minute precision', () => {
        const end = new Date(new Date(start).getTime() + 90_000); // 90 seconds
        expect(elapsedWallClockMinutes(new Date(start), end)).toBe(1.5);
    });

    it('is negative when end precedes start', () => {
        expect(elapsedWallClockMinutes(new Date(endPlus60), new Date(start))).toBe(-60);
    });
});

describe('resolveSessionType', () => {
    it('defaults to NEW_CHAPTER when omitted (Req 4.8)', () => {
        for (const value of [undefined, null, '']) {
            const result = resolveSessionType(value);
            expect(result).toEqual({ ok: true, sessionType: DEFAULT_SESSION_TYPE });
        }
    });

    it('passes through a provided valid session type (Req 4.7)', () => {
        expect(resolveSessionType('REVISION')).toEqual({
            ok: true,
            sessionType: 'REVISION',
        });
    });

    it('rejects an unknown session type', () => {
        const result = resolveSessionType('NAP_TIME');
        expect(result.ok).toBe(false);
    });
});

describe('validateFocusSessionInput', () => {
    const validBase = {
        subjectId: 'subject-1',
        startTime: start,
        endTime: endPlus60,
        focusedDurationMin: 45,
    };

    it('accepts a well-formed session and defaults the session type (Req 4.3/4.8)', () => {
        const result = validateFocusSessionInput(validBase);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.subjectId).toBe('subject-1');
            expect(result.value.focusedDurationMin).toBe(45);
            expect(result.value.sessionType).toBe('NEW_CHAPTER');
            expect(result.value.clientId).toBeNull();
            expect(result.value.startTime).toBeInstanceOf(Date);
        }
    });

    it('persists a provided session type and clientId (Req 4.7, 21)', () => {
        const result = validateFocusSessionInput({
            ...validBase,
            sessionType: 'MOCK_ANALYSIS',
            clientId: '  client-uuid-1  ',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.sessionType).toBe('MOCK_ANALYSIS');
            expect(result.value.clientId).toBe('client-uuid-1');
        }
    });

    it('rejects a missing subject (Req 4.3)', () => {
        for (const subjectId of [undefined, null, '', '   ']) {
            const result = validateFocusSessionInput({ ...validBase, subjectId });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toEqual({ field: 'subjectId' });
            }
        }
    });

    it('rejects a zero or negative focused duration (Req 4.5)', () => {
        for (const focusedDurationMin of [0, -5]) {
            const result = validateFocusSessionInput({ ...validBase, focusedDurationMin });
            expect(result.ok).toBe(false);
        }
    });

    it('rejects a non-integer focused duration (Req 4.5)', () => {
        const result = validateFocusSessionInput({ ...validBase, focusedDurationMin: 12.5 });
        expect(result.ok).toBe(false);
    });

    it('accepts a focused duration equal to the wall-clock span (boundary, Req 4.5)', () => {
        const result = validateFocusSessionInput({ ...validBase, focusedDurationMin: 60 });
        expect(result.ok).toBe(true);
    });

    it('rejects a focused duration greater than the wall-clock span (Req 4.5)', () => {
        const result = validateFocusSessionInput({ ...validBase, focusedDurationMin: 61 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toMatchObject({ field: 'focusedDurationMin' });
        }
    });

    it('rejects when end precedes start so any positive duration exceeds the span', () => {
        const result = validateFocusSessionInput({
            ...validBase,
            startTime: endPlus60,
            endTime: start,
            focusedDurationMin: 1,
        });
        expect(result.ok).toBe(false);
    });

    it('rejects unparseable timestamps', () => {
        expect(validateFocusSessionInput({ ...validBase, startTime: 'not-a-date' }).ok).toBe(
            false,
        );
        expect(validateFocusSessionInput({ ...validBase, endTime: 'not-a-date' }).ok).toBe(
            false,
        );
    });

    it('rejects an unknown session type', () => {
        const result = validateFocusSessionInput({ ...validBase, sessionType: 'BOGUS' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toEqual({ field: 'sessionType' });
        }
    });
});
