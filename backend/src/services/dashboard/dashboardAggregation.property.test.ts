/**
 * Property-based tests for the pure Progress Dashboard aggregation logic.
 *
 *   - Property 23 (task 9.2): per-subject study-time aggregation (Req 5.1, 5.2, 5.3).
 *   - Property 24 (task 9.3): streak computation (Req 5.4, 5.5).
 *   - Property 25 (task 5.4): syllabus completion percentage (Req 12.4, 12.5).
 *
 * Each property is a single fast-check assertion running the global >= 100 iterations
 * (configured in vitest.setup.ts), placed next to the {@link aggregateFocusBySubject} /
 * {@link computeStreak} / {@link computeSyllabusCompletionPercent} logic it validates.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ChapterStatus } from '@prisma/client';

import {
    aggregateFocusBySubject,
    computeStreak,
    computeSyllabusCompletionPercent,
    startOfUtcDay,
    type FocusSessionRow,
} from './dashboardAggregation';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SUBJECT_POOL = ['physics', 'chemistry', 'maths', 'biology'] as const;

const CHAPTER_STATUS_POOL: readonly ChapterStatus[] = [
    'NOT_STARTED',
    'IN_PROGRESS',
    'DONE',
    'REVISED',
];
const COMPLETED_STATUSES: ReadonlySet<ChapterStatus> = new Set<ChapterStatus>([
    'DONE',
    'REVISED',
]);

describe('dashboardAggregation properties', () => {
    // Feature: jee-neet-study-app, Property 23: For any set of focus sessions in a period, the
    // reported per-subject study time equals the sum of focused durations of that subject's
    // sessions, with each session counted under exactly one subject.
    it('Property 23: per-subject study-time aggregation (Req 5.1, 5.2, 5.3)', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        subjectId: fc.constantFrom(...SUBJECT_POOL),
                        focusedDurationMin: fc.integer({ min: 0, max: 600 }),
                        startTime: fc.date({
                            min: new Date('2026-01-01T00:00:00.000Z'),
                            max: new Date('2026-01-07T23:59:59.999Z'),
                        }),
                    }),
                    { maxLength: 50 },
                ),
                (sessions: FocusSessionRow[]) => {
                    const result = aggregateFocusBySubject(sessions);
                    const resultMap = new Map(
                        result.map((r) => [r.subjectId, r.focusedDurationMin]),
                    );

                    // Each subject appears at most once in the output (counted under one subject).
                    expect(resultMap.size).toBe(result.length);

                    // Every aggregated total equals the manual sum of that subject's sessions.
                    for (const subjectId of new Set(sessions.map((s) => s.subjectId))) {
                        const expected = sessions
                            .filter((s) => s.subjectId === subjectId)
                            .reduce((sum, s) => sum + s.focusedDurationMin, 0);
                        expect(resultMap.get(subjectId)).toBe(expected);
                    }

                    // No double counting: the grand total of the aggregate equals the grand
                    // total of all sessions (every session counted exactly once).
                    const aggregateTotal = result.reduce((s, r) => s + r.focusedDurationMin, 0);
                    const sessionTotal = sessions.reduce((s, x) => s + x.focusedDurationMin, 0);
                    expect(aggregateTotal).toBe(sessionTotal);
                },
            ),
        );
    });

    // Feature: jee-neet-study-app, Property 24: For any set of focus-session dates, the reported
    // streak equals the number of consecutive days with at least one session ending today, and
    // is zero whenever there is no session today.
    it('Property 24: streak computation (Req 5.4, 5.5)', () => {
        fc.assert(
            fc.property(
                fc.date({
                    min: new Date('2024-06-01T00:00:00.000Z'),
                    max: new Date('2028-06-01T00:00:00.000Z'),
                }),
                fc.integer({ min: 0, max: 20 }), // length of the consecutive streak ending today
                fc.integer({ min: 0, max: 5 }), // count of disconnected "noise" days beyond the gap
                fc.integer({ min: 0, max: MS_PER_DAY - 1 }), // time-of-day offset within each day
                (now, streakLen, noiseCount, timeOfDayMs) => {
                    const todayStart = startOfUtcDay(now).getTime();
                    const dayAt = (offsetDays: number): Date =>
                        new Date(todayStart - offsetDays * MS_PER_DAY + timeOfDayMs);

                    const days: Date[] = [];

                    // The consecutive streak: today (offset 0) back through offset streakLen-1.
                    for (let i = 0; i < streakLen; i += 1) {
                        days.push(dayAt(i));
                    }
                    // Duplicate today's session (when present) to confirm same-day collapse.
                    if (streakLen > 0) {
                        days.push(dayAt(0));
                    }

                    // Noise days strictly beyond the missing gap day at offset `streakLen`, so
                    // they can never connect to (or create) a streak ending today.
                    for (let j = 0; j < noiseCount; j += 1) {
                        days.push(dayAt(streakLen + 1 + j));
                    }

                    expect(computeStreak(days, now)).toBe(streakLen);
                },
            ),
        );
    });
});

describe('Property 25: Syllabus completion percentage', () => {
    // Feature: jee-neet-study-app, Property 25: For any set of chapters, the syllabus completion percentage equals the count of chapters with status DONE or REVISED divided by the total chapter count, and is zero when there are no chapters.
    it('equals (DONE|REVISED)/total*100, and is zero when there are no chapters (Req 12.4, 12.5)', () => {
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom<ChapterStatus>(...CHAPTER_STATUS_POOL)),
                (statuses) => {
                    const actual = computeSyllabusCompletionPercent(statuses);

                    if (statuses.length === 0) {
                        // No chapters → 0% (Req 12.5), never a divide-by-zero.
                        expect(actual).toBe(0);
                        return;
                    }

                    const completed = statuses.filter((s) => COMPLETED_STATUSES.has(s)).length;
                    const expected = (completed / statuses.length) * 100;

                    // The aggregation rounds to two decimals for clean, deterministic output;
                    // allow that quantization while pinning the underlying ratio (Req 12.4).
                    expect(actual).toBeCloseTo(expected, 2);
                    expect(actual).toBeGreaterThanOrEqual(0);
                    expect(actual).toBeLessThanOrEqual(100);
                },
            ),
        );
    });
});
