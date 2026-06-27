/**
 * Property-based test for the pure Study_Velocity projection and target-completion-date
 * derivation.
 *
 *   - Property 30 (task 10.5): target completion + velocity projection (Req 14.6, 14.7, 14.8).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the {@link projectVelocity} logic. The target completion
 * date is derived by the shared {@link computeTargetCompletionDate} from the NTA worker so
 * the handler and worker never drift.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { startOfUtcDay } from '@/services/dashboard';
import { computeTargetCompletionDate } from '@/workers/ntaIngestion/examDate';

import { projectVelocity } from './velocity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('velocity projection properties', () => {
    // Feature: jee-neet-study-app, Property 30: For any target exam date and revision buffer,
    // the target completion date equals the exam date minus the buffer; and for any pending
    // estimated hours and recent study rate, the projected completion date is derived from
    // those values and the reported status correctly indicates ahead/behind the target
    // completion date with the whole-day difference.
    it('Property 30: target completion + velocity projection (Req 14.6, 14.7, 14.8)', () => {
        fc.assert(
            fc.property(
                fc.date({
                    min: new Date('2025-01-01T00:00:00.000Z'),
                    max: new Date('2030-01-01T00:00:00.000Z'),
                }),
                fc.integer({ min: 0, max: 120 }), // revision buffer (days)
                fc.date({
                    min: new Date('2024-01-01T00:00:00.000Z'),
                    max: new Date('2030-01-01T00:00:00.000Z'),
                }),
                // remaining estimated hours: include 0 (nothing left) plus positive values.
                fc.oneof(fc.constant(0), fc.double({ min: 0.01, max: 5000, noNaN: true })),
                // recent study rate (hours/day): include 0 (indefinite) plus positive values.
                fc.oneof(fc.constant(0), fc.double({ min: 0.1, max: 100, noNaN: true })),
                (examDate, bufferDays, now, remainingHours, recentRatePerDay) => {
                    // Part 1: target completion = exam date − buffer (Req 14.6).
                    const targetCompletionDate = computeTargetCompletionDate(examDate, bufferDays);
                    expect(targetCompletionDate.getTime()).toBe(
                        examDate.getTime() - bufferDays * MS_PER_DAY,
                    );

                    const result = projectVelocity({
                        remainingHours,
                        recentRatePerDay,
                        targetCompletionDate,
                        now,
                    });
                    expect(result.targetCompletionDate).toBe(targetCompletionDate);

                    const todayStart = startOfUtcDay(now).getTime();
                    const targetDayStart = startOfUtcDay(targetCompletionDate).getTime();

                    // Part 2: projection ahead/behind with whole-day delta (Req 14.7, 14.8).
                    if (remainingHours <= 0) {
                        // Nothing left to study: completed as of today regardless of rate.
                        const expectedDelta = Math.round(
                            Math.abs(targetDayStart - todayStart) / MS_PER_DAY,
                        );
                        expect(result.projectedCompletionDate?.getTime()).toBe(todayStart);
                        expect(result.deltaDays).toBe(expectedDelta);
                        expect(result.status).toBe(todayStart <= targetDayStart ? 'AHEAD' : 'BEHIND');
                    } else if (recentRatePerDay <= 0) {
                        // Work remains but no recent pace: indefinite, reported BEHIND.
                        expect(result.projectedCompletionDate).toBeNull();
                        expect(result.deltaDays).toBeNull();
                        expect(result.status).toBe('BEHIND');
                    } else {
                        const projectedDays = Math.ceil(remainingHours / recentRatePerDay);
                        const projectedDayStart = todayStart + projectedDays * MS_PER_DAY;
                        const expectedDelta = Math.round(
                            Math.abs(targetDayStart - projectedDayStart) / MS_PER_DAY,
                        );
                        expect(result.projectedCompletionDate?.getTime()).toBe(projectedDayStart);
                        expect(result.deltaDays).toBe(expectedDelta);
                        expect(result.status).toBe(
                            projectedDayStart <= targetDayStart ? 'AHEAD' : 'BEHIND',
                        );
                    }
                },
            ),
        );
    });
});
