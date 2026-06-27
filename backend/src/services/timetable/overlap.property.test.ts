/**
 * Property-based test for the pure block-edit overlap logic (`./overlap`).
 *
 *   - Property 9 (task 6.10): edit accept/reject is overlap-correct and atomic (Req 3.4–3.6).
 *
 * A single fast-check assertion running the global >= 100 iterations (vitest.setup.ts). The
 * atomic accept/reject decision behind a `PATCH /timetable/blocks/:id` is
 * {@link proposedBlockConflicts}: it must return "reject" exactly when the proposed interval
 * overlaps any other study block OR any fixed commitment, and "accept" otherwise. This pins
 * that decision against an independent reference overlap computation. (The handler's
 * transactional atomicity — no write on reject — is covered by blockEditService.test.ts.)
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    proposedBlockConflicts,
    type BlockInterval,
    type RecurringCommitment,
} from './overlap';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
// A Monday UTC midnight; adding day offsets keeps blocks inside single UTC days.
const BASE = new Date('2026-01-05T00:00:00.000Z').getTime();

/** Reference half-open overlap, computed independently of the module under test. */
function overlaps(s1: number, e1: number, s2: number, e2: number): boolean {
    return s1 < e2 && s2 < e1;
}

describe('Property 9: Edit accept/reject is overlap-correct and atomic', () => {
    // Feature: jee-neet-study-app, Property 9: For any study-block edit, if the resulting interval overlaps any other study block or fixed commitment the edit is rejected with a conflict error and the original block is left unchanged; otherwise the edit is accepted and persisted.
    it('rejects iff the proposed interval overlaps another block or a commitment (Req 3.4-3.6)', () => {
        fc.assert(
            fc.property(
                // Proposed block: a day offset (0..6), start minute, and duration.
                fc.record({
                    dayOffset: fc.integer({ min: 0, max: 6 }),
                    startMinute: fc.integer({ min: 0, max: 23 * 60 }),
                    durationMin: fc.integer({ min: 30, max: 180 }),
                }),
                // Other concrete blocks within the same week.
                fc.array(
                    fc.record({
                        dayOffset: fc.integer({ min: 0, max: 6 }),
                        startMinute: fc.integer({ min: 0, max: 23 * 60 }),
                        durationMin: fc.integer({ min: 30, max: 180 }),
                    }),
                    { maxLength: 8 },
                ),
                // Recurring weekly commitments, kept within a single day so both bounds parse
                // as valid "HH:mm" (a malformed window would be ignored by the module).
                fc.array(
                    fc
                        .record({
                            dayOfWeek: fc.integer({ min: 0, max: 6 }),
                            startMinute: fc.integer({ min: 0, max: 23 * 60 }),
                            lengthMin: fc.integer({ min: 30, max: 180 }),
                        })
                        .map((c) => ({
                            ...c,
                            // Keep the end strictly within the day so "HH:mm" stays valid
                            // (an end of 1440 would render as "24:00" and be treated as malformed).
                            lengthMin: Math.min(c.lengthMin, 24 * 60 - 1 - c.startMinute),
                        })),
                    { maxLength: 6 },
                ),
                (proposedSpec, otherSpecs, commitmentSpecs) => {
                    const toBlock = (spec: {
                        dayOffset: number;
                        startMinute: number;
                        durationMin: number;
                    }): BlockInterval => ({
                        startTime: new Date(
                            BASE + spec.dayOffset * MS_PER_DAY + spec.startMinute * MS_PER_MINUTE,
                        ),
                        durationMin: spec.durationMin,
                    });

                    const proposed = toBlock(proposedSpec);
                    const otherBlocks = otherSpecs.map(toBlock);
                    const commitments: RecurringCommitment[] = commitmentSpecs.map((c) => {
                        const pad = (min: number) =>
                            `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(
                                min % 60,
                            ).padStart(2, '0')}`;
                        return {
                            dayOfWeek: c.dayOfWeek,
                            startTime: pad(c.startMinute),
                            endTime: pad(c.startMinute + c.lengthMin),
                        };
                    });

                    // Independent reference: does the proposed interval overlap anything?
                    const proposedStart = proposed.startTime.getTime();
                    const proposedEnd = proposedStart + proposed.durationMin * MS_PER_MINUTE;
                    const proposedDay = proposed.startTime.getUTCDay();
                    const proposedMidnight =
                        Math.floor(proposedStart / MS_PER_DAY) * MS_PER_DAY;
                    const proposedStartMin = (proposedStart - proposedMidnight) / MS_PER_MINUTE;
                    const proposedEndMin = proposedStartMin + proposed.durationMin;

                    const blockConflict = otherBlocks.some((other) => {
                        const s = other.startTime.getTime();
                        return overlaps(proposedStart, proposedEnd, s, s + other.durationMin * MS_PER_MINUTE);
                    });
                    const commitmentConflict = commitmentSpecs.some(
                        (c) =>
                            c.dayOfWeek === proposedDay &&
                            overlaps(
                                proposedStartMin,
                                proposedEndMin,
                                c.startMinute,
                                c.startMinute + c.lengthMin,
                            ),
                    );
                    const expectedReject = blockConflict || commitmentConflict;

                    expect(proposedBlockConflicts(proposed, otherBlocks, commitments)).toBe(
                        expectedReject,
                    );
                },
            ),
        );
    });
});
