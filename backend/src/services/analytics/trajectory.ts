/**
 * Pure Score-Trajectory assembly & normalization (task 5.1; design "Score-Data-Point
 * normalization & trajectory assembly"; Req 2.1, 2.2, 2.3, 2.4, 2.5).
 *
 * The Score Trajectory endpoint surfaces a single time-ordered series that combines the
 * user's user-entered External_Mock_Scores with the App_Derived_Scores from their
 * PYQ_Attempts and Timed_Paper_Attempts, normalized onto a common percentage scale so the
 * three sources are plotted together (Req 2.1, 2.2). This module performs that assembly as
 * a framework- and database-free pure function so it can be unit-tested in isolation and is
 * the surface exercised by the property test (task 5.2, Property 3).
 *
 * Following the Phase 1 layering convention (see `dashboardAggregation.ts`,
 * `lib/scoring/score.ts`), this module:
 *   - imports no Prisma client and no framework code,
 *   - accepts already-read plain rows (the thin service handler loads them, scoped to the
 *     requesting user, and passes them in),
 *   - never mutates its inputs (returns a new array),
 *   - is the property-test surface for trajectory behavior.
 *
 * ── Per-source normalization (Req 2.2, 2.3) ───────────────────────────────────────────────
 * Each source row becomes exactly one labeled {@link ScoreDataPoint}:
 *   - External_Mock_Score → { date: testDate,  source: 'EXTERNAL_MOCK',        obtained: obtainedScore, max: maxScore }
 *   - PYQ_Attempt         → { date: createdAt,  source: 'PYQ_ATTEMPT',          obtained: totalScore,    max: perQuestion.length }
 *   - Timed_Paper_Attempt → { date: createdAt,  source: 'TIMED_PAPER_ATTEMPT',  obtained: totalScore,    max: perQuestion.length }
 *
 * `normalizedPercent = max > 0 ? obtained / max * 100 : 0` (the `max <= 0` guard avoids a
 * divide-by-zero for an attempt that scored zero questions).
 *
 * ── Filtering & ordering (Req 2.4, 2.5) ───────────────────────────────────────────────────
 * When a date range is supplied, only points whose `date` lies within the inclusive
 * `[from, to]` interval are kept; either bound may be omitted to leave that side open.
 * Points are sorted ascending by date. With no source rows at all the series is `[]`.
 */

/** The source label carried by every Score_Data_Point (Req 2.3). */
export const ScoreDataPointSource = {
    EXTERNAL_MOCK: 'EXTERNAL_MOCK',
    PYQ_ATTEMPT: 'PYQ_ATTEMPT',
    TIMED_PAPER_ATTEMPT: 'TIMED_PAPER_ATTEMPT',
} as const;

export type ScoreDataPointSource =
    (typeof ScoreDataPointSource)[keyof typeof ScoreDataPointSource];

/**
 * One External_Mock_Score row as needed for trajectory assembly. Deliberately minimal: the
 * test date used to place the point in time (Req 2.4) and the entered obtained/max marks
 * used for normalization (Req 2.2). Plain DB-free shape — the service maps the persisted
 * `ExternalMockScore` row onto this.
 */
export interface MockScoreRow {
    testDate: Date;
    obtainedScore: number;
    maxScore: number;
}

/**
 * One PYQ_Attempt or Timed_Paper_Attempt row as needed for trajectory assembly. The
 * App_Derived_Score uses `totalScore` as obtained marks and the number of scored questions
 * (`perQuestion.length`) as the maximum (design "Score Trajectory endpoint"). Only the
 * length of `perQuestion` is consumed here, so any per-question element shape is accepted.
 */
export interface AttemptRow {
    createdAt: Date;
    totalScore: number;
    perQuestion: ReadonlyArray<unknown>;
}

/**
 * An inclusive date range filter. Either bound may be omitted to leave that side open; an
 * omitted range (or `undefined`) keeps every point (Req 2.4).
 */
export interface DateRange {
    from?: Date;
    to?: Date;
}

/** A single dated, normalized, labeled point in the Score_Trajectory. */
export interface ScoreDataPoint {
    date: Date;
    source: ScoreDataPointSource;
    /** `obtained / max * 100`, or `0` when `max <= 0` (Req 2.2). */
    normalizedPercent: number;
    /** Obtained marks: entered score (mock) or `totalScore` (attempt). */
    obtained: number;
    /** Maximum marks: entered max (mock) or scored-question count (attempt). */
    max: number;
}

/**
 * Normalize obtained/max marks to a percentage of the maximum (Req 2.2). Guards against a
 * non-positive maximum (e.g. an attempt with zero scored questions) by reporting `0`
 * rather than dividing by zero.
 */
function normalizePercent(obtained: number, max: number): number {
    return max > 0 ? (obtained / max) * 100 : 0;
}

/** Build a labeled point from an External_Mock_Score row (Req 2.2, 2.3). */
function pointFromMockScore(row: MockScoreRow): ScoreDataPoint {
    return {
        date: row.testDate,
        source: ScoreDataPointSource.EXTERNAL_MOCK,
        normalizedPercent: normalizePercent(row.obtainedScore, row.maxScore),
        obtained: row.obtainedScore,
        max: row.maxScore,
    };
}

/** Build a labeled App_Derived_Score point from an attempt row (Req 2.2, 2.3). */
function pointFromAttempt(row: AttemptRow, source: ScoreDataPointSource): ScoreDataPoint {
    const max = row.perQuestion.length;
    return {
        date: row.createdAt,
        source,
        normalizedPercent: normalizePercent(row.totalScore, max),
        obtained: row.totalScore,
        max,
    };
}

/**
 * Keep only the points whose `date` falls within the inclusive `[from, to]` range (Req 2.4).
 * An omitted range, or a range with both bounds omitted, keeps every point; either bound
 * may be omitted independently to leave that side open.
 */
function filterByRange(
    points: readonly ScoreDataPoint[],
    range: DateRange | undefined,
): ScoreDataPoint[] {
    if (range === undefined || (range.from === undefined && range.to === undefined)) {
        return [...points];
    }
    const fromMs = range.from?.getTime();
    const toMs = range.to?.getTime();
    return points.filter((point) => {
        const t = point.date.getTime();
        if (fromMs !== undefined && t < fromMs) {
            return false;
        }
        if (toMs !== undefined && t > toMs) {
            return false;
        }
        return true;
    });
}

/**
 * Assemble the user's Score_Trajectory: one normalized, labeled {@link ScoreDataPoint} per
 * source row, drawn from the user's External_Mock_Scores plus the App_Derived_Scores of
 * their PYQ_Attempts and Timed_Paper_Attempts (Req 2.1, 2.2, 2.3). The combined series is
 * filtered by the optional inclusive date range (Req 2.4) and sorted ascending by date.
 * With no source rows at all the result is `[]` (Req 2.5).
 *
 * Pure: no I/O, builds and returns a new array, does not mutate any input row or array.
 *
 * @param mockScores    The user's External_Mock_Score rows.
 * @param pyqAttempts   The user's PYQ_Attempt rows.
 * @param timedAttempts The user's Timed_Paper_Attempt rows.
 * @param range         Optional inclusive `[from, to]` date filter (Req 2.4).
 */
export function assembleScoreTrajectory(
    mockScores: readonly MockScoreRow[],
    pyqAttempts: readonly AttemptRow[],
    timedAttempts: readonly AttemptRow[],
    range?: DateRange,
): ScoreDataPoint[] {
    const points: ScoreDataPoint[] = [
        ...mockScores.map(pointFromMockScore),
        ...pyqAttempts.map((row) => pointFromAttempt(row, ScoreDataPointSource.PYQ_ATTEMPT)),
        ...timedAttempts.map((row) =>
            pointFromAttempt(row, ScoreDataPointSource.TIMED_PAPER_ATTEMPT),
        ),
    ];

    const filtered = filterByRange(points, range);
    filtered.sort((a, b) => a.date.getTime() - b.date.getTime());
    return filtered;
}
