/**
 * Property-based test for the pure Score-Trajectory assembly & normalization logic
 * (task 5.2, design "Score-Data-Point normalization & trajectory assembly").
 *
 *   - Property 3 (task 5.2): score trajectory assembly, normalization, labeling, and
 *     filtering (Req 2.1, 2.2, 2.3, 2.4, 2.5).
 *
 * A single fast-check assertion running a minimum of 100 iterations, placed next to the
 * {@link assembleScoreTrajectory} logic it validates. Generators produce arbitrary dates,
 * obtained/max marks (including `max === 0` and varying `perQuestion` lengths), and an
 * optional inclusive date range, so the property exercises count, labeling, normalization,
 * ordering, range filtering, and the empty-input case across a wide input space.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    assembleScoreTrajectory,
    ScoreDataPointSource,
    type AttemptRow,
    type DateRange,
    type MockScoreRow,
} from './trajectory';

// Run the full validation count regardless of the lighter global default (vitest.setup.ts).
const NUM_RUNS = Math.max(
    100,
    Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10) || 0,
);

const DATE_MIN = new Date('2024-01-01T00:00:00.000Z');
const DATE_MAX = new Date('2027-12-31T23:59:59.999Z');

const arbDate = fc.date({ min: DATE_MIN, max: DATE_MAX });

// External_Mock_Score row: an arbitrary obtained/max pair including max === 0 (the
// divide-by-zero guard case) and obtained values that may exceed max.
const arbMockScore: fc.Arbitrary<MockScoreRow> = fc.record({
    testDate: arbDate,
    obtainedScore: fc.double({ min: 0, max: 720, noNaN: true }),
    maxScore: fc.double({ min: 0, max: 720, noNaN: true }),
});

// Attempt row: `totalScore` as obtained marks and a `perQuestion` array of arbitrary
// length (including 0) supplying the maximum as its `.length`. Element shape is irrelevant.
const arbAttempt: fc.Arbitrary<AttemptRow> = fc.record({
    createdAt: arbDate,
    totalScore: fc.double({ min: 0, max: 300, noNaN: true }),
    perQuestion: fc.array(fc.constant(null), { maxLength: 90 }),
});

// Optional inclusive [from, to] range; either bound may be omitted to leave that side open.
const arbRange: fc.Arbitrary<DateRange | undefined> = fc.option(
    fc.record({
        from: fc.option(arbDate, { nil: undefined }),
        to: fc.option(arbDate, { nil: undefined }),
    }),
    { nil: undefined },
);

const EXPECTED_PERCENT = (obtained: number, max: number): number =>
    max > 0 ? (obtained / max) * 100 : 0;

const inRange = (date: Date, range: DateRange | undefined): boolean => {
    if (range === undefined || (range.from === undefined && range.to === undefined)) {
        return true;
    }
    const t = date.getTime();
    if (range.from !== undefined && t < range.from.getTime()) {
        return false;
    }
    if (range.to !== undefined && t > range.to.getTime()) {
        return false;
    }
    return true;
};

describe('trajectory assembly properties', () => {
    // Feature: performance-analytics, Property 3: For any sets of External_Mock_Scores,
    // PYQ_Attempts, and Timed_Paper_Attempts (and any optional date range), the assembled
    // Score_Trajectory contains exactly one point per source row whose date falls in range;
    // each point is labeled with its source (EXTERNAL_MOCK / PYQ_ATTEMPT /
    // TIMED_PAPER_ATTEMPT); each point's normalizedPercent equals obtained/max*100 (0 when
    // max === 0); points are ascending by date; and the trajectory is empty when there are
    // no source rows.
    it('Property 3: score trajectory assembly, normalization, labeling, and filtering (Req 2.1, 2.2, 2.3, 2.4, 2.5)', () => {
        fc.assert(
            fc.property(
                fc.array(arbMockScore, { maxLength: 30 }),
                fc.array(arbAttempt, { maxLength: 30 }),
                fc.array(arbAttempt, { maxLength: 30 }),
                arbRange,
                (mockScores, pyqAttempts, timedAttempts, range) => {
                    const points = assembleScoreTrajectory(
                        mockScores,
                        pyqAttempts,
                        timedAttempts,
                        range,
                    );

                    // ── Empty-input case (Req 2.5) ───────────────────────────────────────
                    if (
                        mockScores.length === 0 &&
                        pyqAttempts.length === 0 &&
                        timedAttempts.length === 0
                    ) {
                        expect(points).toEqual([]);
                    }

                    // ── Count: exactly one point per in-range source row (Req 2.1, 2.4) ──
                    const expectedMock = mockScores.filter((m) => inRange(m.testDate, range));
                    const expectedPyq = pyqAttempts.filter((a) => inRange(a.createdAt, range));
                    const expectedTimed = timedAttempts.filter((a) =>
                        inRange(a.createdAt, range),
                    );
                    const expectedCount =
                        expectedMock.length + expectedPyq.length + expectedTimed.length;
                    expect(points.length).toBe(expectedCount);

                    // Per-source counts (correct labeling distribution, Req 2.3).
                    const bySource = {
                        [ScoreDataPointSource.EXTERNAL_MOCK]: 0,
                        [ScoreDataPointSource.PYQ_ATTEMPT]: 0,
                        [ScoreDataPointSource.TIMED_PAPER_ATTEMPT]: 0,
                    };
                    for (const p of points) {
                        bySource[p.source] += 1;
                    }
                    expect(bySource[ScoreDataPointSource.EXTERNAL_MOCK]).toBe(
                        expectedMock.length,
                    );
                    expect(bySource[ScoreDataPointSource.PYQ_ATTEMPT]).toBe(expectedPyq.length);
                    expect(bySource[ScoreDataPointSource.TIMED_PAPER_ATTEMPT]).toBe(
                        expectedTimed.length,
                    );

                    for (const p of points) {
                        // ── Labeling: a valid known source (Req 2.3) ────────────────────
                        expect(Object.values(ScoreDataPointSource)).toContain(p.source);

                        // ── Range filtering: every point's date is in range (Req 2.4) ───
                        expect(inRange(p.date, range)).toBe(true);

                        // ── Normalization: obtained/max*100, 0 when max === 0 (Req 2.2) ─
                        expect(p.normalizedPercent).toBeCloseTo(
                            EXPECTED_PERCENT(p.obtained, p.max),
                            8,
                        );
                        if (p.max === 0) {
                            expect(p.normalizedPercent).toBe(0);
                        }
                    }

                    // ── Ordering: ascending by date (Req 2.1) ───────────────────────────
                    for (let i = 1; i < points.length; i += 1) {
                        expect(points[i].date.getTime()).toBeGreaterThanOrEqual(
                            points[i - 1].date.getTime(),
                        );
                    }
                },
            ),
            { numRuns: NUM_RUNS },
        );
    });
});
