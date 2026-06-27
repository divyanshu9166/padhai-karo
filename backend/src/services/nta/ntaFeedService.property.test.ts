import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ExamTrack } from '@prisma/client';

import {
    buildNtaFeedWhere,
    NTA_FEED_ORDER_BY,
    trackToExamScopes,
} from './ntaFeedService';
import { EXAM_SCOPES, examScopeToTrack, type ExamScope } from '@/workers/ntaIngestion/types';

/**
 * Property-based test for the NTA feed read service (task 17.4).
 *
 * Exercises the pure feed helpers — the track→scopes partition ({@link trackToExamScopes} /
 * {@link buildNtaFeedWhere}) and the ordering constant ({@link NTA_FEED_ORDER_BY}) — by
 * modelling the feed query in memory: filter announcements to the user's track scopes, then
 * sort by the production `orderBy`. See design "Correctness Properties" → Property 45.
 *
 * Validates: Requirements 20.5
 */

const TRACKS: readonly ExamTrack[] = ['JEE', 'NEET'];
const trackArb = fc.constantFrom(...TRACKS);
const examScopeArb = fc.constantFrom(...EXAM_SCOPES);

interface FeedRow {
    id: string;
    examScope: ExamScope;
    publishedAt: Date;
}

const MIN_MS = Date.UTC(2024, 0, 1);
const MAX_MS = Date.UTC(2027, 0, 1);

const rowArb: fc.Arbitrary<FeedRow> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 6 }),
    examScope: examScopeArb,
    publishedAt: fc.integer({ min: MIN_MS, max: MAX_MS }).map((ms) => new Date(ms)),
});

/** Generic comparator derived from the production `orderBy` so the test honours the constant. */
function compareByFeedOrder(a: FeedRow, b: FeedRow): number {
    for (const clause of NTA_FEED_ORDER_BY) {
        const [field, dir] = Object.entries(clause)[0] as [keyof FeedRow, 'asc' | 'desc'];
        const av = a[field];
        const bv = b[field];
        let cmp = av < bv ? -1 : av > bv ? 1 : 0;
        if (dir === 'desc') cmp = -cmp;
        if (cmp !== 0) return cmp;
    }
    return 0;
}

/** Extract the `in` scope list the production where-clause filters by. */
function whereScopes(track: ExamTrack): ExamScope[] {
    const filter = buildNtaFeedWhere(track).examScope as { in: ExamScope[] };
    return filter.in;
}

/** Model the feed query: track-filter via the production where-clause, then order. */
function selectFeed(track: ExamTrack, rows: FeedRow[]): FeedRow[] {
    const allowed = new Set(whereScopes(track));
    return rows.filter((r) => allowed.has(r.examScope)).sort(compareByFeedOrder);
}

describe('Property 45: Feed ordering and track filtering', () => {
    // Feature: jee-neet-study-app, Property 45: For any user, the NTA feed returns announcements ordered chronologically and every returned announcement applies to the user's exam track.
    it('returns only the track\'s announcements, most-recent-first, with a correct scope partition', () => {
        fc.assert(
            fc.property(trackArb, fc.array(rowArb, { maxLength: 12 }), (track, rows) => {
                // The track→scopes mapping partitions all scopes correctly: a scope belongs to
                // a track iff it maps back to that track.
                const trackScopes = new Set(trackToExamScopes(track));
                for (const scope of EXAM_SCOPES) {
                    expect(trackScopes.has(scope)).toBe(examScopeToTrack(scope) === track);
                }

                const feed = selectFeed(track, rows);

                // Every returned announcement applies to the user's exam track.
                for (const row of feed) {
                    expect(examScopeToTrack(row.examScope)).toBe(track);
                }

                // The feed contains exactly the in-track rows (none dropped, none extra).
                const expectedCount = rows.filter(
                    (r) => examScopeToTrack(r.examScope) === track,
                ).length;
                expect(feed).toHaveLength(expectedCount);

                // Ordering is chronological, most-recent-first.
                for (let i = 1; i < feed.length; i += 1) {
                    expect(feed[i - 1].publishedAt.getTime()).toBeGreaterThanOrEqual(
                        feed[i].publishedAt.getTime(),
                    );
                }
            }),
        );
    });
});
