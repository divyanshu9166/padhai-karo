/**
 * Property-based test for the PYQ practice filter clause.
 *
 *   - Property 32 (task 11.5): PYQ filtering (Req 6.1).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the {@link buildPyqWhere} logic it validates. The
 * `where` clause must ALWAYS pin the requested year, subject, and the user's exam track,
 * and ALWAYS exclude flagged-for-review records (`flaggedForReview: false`) independent of
 * the caller's input.
 */
import type { ExamTrack } from '@prisma/client';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildPyqWhere } from './pyqService';

describe('buildPyqWhere properties', () => {
    // Feature: jee-neet-study-app, Property 32: For any year/subject query, every returned
    // PYQ matches the requested year and subject and the user's exam track.
    it('Property 32: PYQ filtering pins year, subject, track, and excludes flagged (Req 6.1)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom<ExamTrack>('JEE', 'NEET'),
                fc.integer({ min: 1900, max: 3000 }),
                fc.string({ minLength: 1 }),
                (examTrack, year, subjectId) => {
                    const where = buildPyqWhere({ examTrack, year, subjectId });

                    // The query is pinned to exactly the requested track/year/subject.
                    expect(where.examTrack).toBe(examTrack);
                    expect(where.year).toBe(year);
                    expect(where.subjectId).toBe(subjectId);

                    // Flagged-for-review records are ALWAYS excluded, regardless of input.
                    expect(where.flaggedForReview).toBe(false);
                },
            ),
        );
    });
});
