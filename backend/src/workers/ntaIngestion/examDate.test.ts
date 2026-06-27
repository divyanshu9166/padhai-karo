import { describe, expect, it } from 'vitest';

import {
    applyExamDateChange,
    computeCountdownDays,
    computeTargetCompletionDate,
} from './examDate';

describe('computeTargetCompletionDate', () => {
    it('subtracts the revision buffer in whole days', () => {
        const exam = new Date('2026-04-12T00:00:00.000Z');
        const completion = computeTargetCompletionDate(exam, 45);
        expect(completion.toISOString()).toBe('2026-02-26T00:00:00.000Z');
    });

    it('does not mutate the input date', () => {
        const exam = new Date('2026-04-12T00:00:00.000Z');
        computeTargetCompletionDate(exam, 45);
        expect(exam.toISOString()).toBe('2026-04-12T00:00:00.000Z');
    });

    it('returns the exam date itself when the buffer is zero', () => {
        const exam = new Date('2026-04-12T00:00:00.000Z');
        expect(computeTargetCompletionDate(exam, 0).getTime()).toBe(exam.getTime());
    });
});

describe('computeCountdownDays', () => {
    it('counts whole days remaining, rounding a partial day up', () => {
        const exam = new Date('2026-04-12T00:00:00.000Z');
        const now = new Date('2026-04-02T06:00:00.000Z');
        expect(computeCountdownDays(exam, now)).toBe(10);
    });

    it('is zero once the exam instant has passed', () => {
        const exam = new Date('2026-04-12T00:00:00.000Z');
        const now = new Date('2026-04-12T00:00:00.000Z');
        expect(computeCountdownDays(exam, now)).toBe(0);
        expect(computeCountdownDays(exam, new Date('2026-05-01T00:00:00.000Z'))).toBe(0);
    });
});

describe('applyExamDateChange', () => {
    it('recomputes target/completion/countdown per affected profile', () => {
        const newExamDate = new Date('2026-04-12T00:00:00.000Z');
        const now = new Date('2026-01-01T00:00:00.000Z');
        const updates = applyExamDateChange(
            [
                { userId: 'u1', revisionBufferDays: 45 },
                { userId: 'u2', revisionBufferDays: 30 },
            ],
            newExamDate,
            now,
        );

        expect(updates).toHaveLength(2);
        expect(updates[0]).toEqual({
            userId: 'u1',
            targetExamDate: newExamDate,
            targetCompletionDate: new Date('2026-02-26T00:00:00.000Z'),
            countdownDays: computeCountdownDays(newExamDate, now),
        });
        // Target_Completion_Date = Target_Exam_Date - Revision_Buffer.
        expect(updates[1].targetCompletionDate.toISOString()).toBe('2026-03-13T00:00:00.000Z');
    });

    it('returns no updates when there are no affected profiles', () => {
        expect(
            applyExamDateChange([], new Date('2026-04-12T00:00:00.000Z'), new Date()),
        ).toEqual([]);
    });
});
