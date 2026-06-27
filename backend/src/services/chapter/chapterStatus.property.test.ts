import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ChapterStatus } from '@prisma/client';

import { CHAPTER_STATUS_ORDER, isValidStatusTransition } from './chapterStatus';

/**
 * Property-based test for the chapter status transition ordering (task 5.5).
 *
 * Exercises the pure {@link isValidStatusTransition} lifecycle rule directly — no database
 * or framework involved. See design "Correctness Properties" → Property 26.
 */

const statusArb = fc.constantFrom<ChapterStatus>(...CHAPTER_STATUS_ORDER);

describe('Property 26: Chapter status transition ordering', () => {
    // Feature: jee-neet-study-app, Property 26: For any status transition request, it is accepted only if it moves forward along the order NOT_STARTED → IN_PROGRESS → DONE → REVISED, and any backward transition is rejected.
    it('accepts a transition iff `to` ranks strictly higher than `from`; backward/same rejected', () => {
        fc.assert(
            fc.property(statusArb, statusArb, (from, to) => {
                const fromRank = CHAPTER_STATUS_ORDER.indexOf(from);
                const toRank = CHAPTER_STATUS_ORDER.indexOf(to);
                const expected = toRank > fromRank;

                expect(isValidStatusTransition(from, to)).toBe(expected);

                // Same-state and backward moves are never accepted.
                if (toRank <= fromRank) {
                    expect(isValidStatusTransition(from, to)).toBe(false);
                }
            }),
        );
    });
});
