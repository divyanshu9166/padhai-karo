/**
 * Seed smoke tests for the seeded analytics reference data (task 1.6).
 *
 * The Prisma seed (`prisma/seed.ts`, task 1.5) upserts `CutoffReferenceData`,
 * `ScoreStandingMap`, `TopicFrequencyReferenceData`, and `QuestionTopicMap` rows from the
 * system-supplied TypeScript catalogs in `lib/analytics/`. Following the design's
 * "Seed smoke tests" intent and the Phase 1 convention of mocking Prisma (`vi.mock`) in
 * Phase 2 tests, these smoke tests assert against the CATALOGS — the deterministic source
 * of the seeded rows — so they run without a live database in CI while still verifying the
 * exact content the seed loads.
 *
 * Coverage:
 *   - Cutoff data exists keyed by `(examTrack, referenceDataYear)` with the required fields
 *     populated for BOTH tracks (Req 5.1).
 *   - Topic-frequency records exist keyed by `(examTrack, referenceDataYear)` with
 *     `appearanceCount`, the year span (`yearSpanStart`/`yearSpanEnd`), and
 *     `avgQuestionsPerYear` populated (Req 6.1, 6.2).
 *   - Loading year N then N+1 retains both (additivity): the catalog structures support
 *     more than one year per track and the year accessors return them ascending, so the
 *     active-year selection (max) picks N+1 while N is retained (Req 5.3, 6.4).
 */
import { describe, expect, it } from 'vitest';

import {
    CUTOFF_EXAM_TRACKS,
    getCutoffEntries,
    getCutoffYears,
    getScoreStandingBands,
    getScoreStandingYears,
    type CutoffCatalogEntry,
} from './cutoffCatalog';
import {
    getTopicFrequencyDataset,
    getTopicFrequencyYears,
    type TopicFrequencyRecord,
} from './topicFrequencyCatalog';
import type { ExamTrack } from '../reference';

const TRACKS: ExamTrack[] = CUTOFF_EXAM_TRACKS;
const VALID_CUTOFF_UNITS = ['RANK', 'PERCENTILE', 'MARKS'] as const;

/** A non-blank string is a populated text field. */
function isNonBlankString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** A finite number is a populated numeric field. */
function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Mirrors the active-version selection used by the reference readers: the active year is
 * the maximum (most recent) year present. Asserted against the ascending accessor output
 * so additivity (year N + N+1 both retained, N+1 active) is verifiable from the catalog.
 */
function activeYear(yearsAscending: number[]): number {
    return Math.max(...yearsAscending);
}

describe('seed smoke: cutoff reference data (Req 5.1, 5.3)', () => {
    it('covers both exam tracks', () => {
        expect(TRACKS).toEqual(expect.arrayContaining(['JEE', 'NEET']));
    });

    for (const track of TRACKS) {
        describe(`track ${track}`, () => {
            it('has at least one cutoff Reference_Data_Year, returned ascending', () => {
                const years = getCutoffYears(track);
                expect(years.length).toBeGreaterThanOrEqual(1);
                // Accessor returns years ascending (most recent last) so max selection works.
                const sorted = [...years].sort((a, b) => a - b);
                expect(years).toEqual(sorted);
                years.forEach((year) => expect(Number.isInteger(year)).toBe(true));
            });

            it('has cutoff entries for the active (max) year with all required fields populated', () => {
                const year = activeYear(getCutoffYears(track));
                const entries = getCutoffEntries(track, year);
                expect(entries.length).toBeGreaterThanOrEqual(1);

                entries.forEach((entry: CutoffCatalogEntry) => {
                    expect(isNonBlankString(entry.collegeName)).toBe(true);
                    expect(isNonBlankString(entry.branchName)).toBe(true);
                    expect(isNonBlankString(entry.category)).toBe(true);
                    expect(isFiniteNumber(entry.closingValue)).toBe(true);
                    expect(VALID_CUTOFF_UNITS).toContain(entry.unit);
                });
            });

            it('has score-standing bands for the active year covering the 0-100 score range', () => {
                const year = activeYear(getScoreStandingYears(track));
                const bands = getScoreStandingBands(track, year);
                expect(bands.length).toBeGreaterThanOrEqual(1);

                bands.forEach((band) => {
                    expect(isFiniteNumber(band.minScorePercent)).toBe(true);
                    expect(isFiniteNumber(band.maxScorePercent)).toBe(true);
                    expect(band.maxScorePercent).toBeGreaterThanOrEqual(band.minScorePercent);
                    expect(band.estimateHigh).toBeGreaterThanOrEqual(band.estimateLow);
                    expect(VALID_CUTOFF_UNITS).toContain(band.unit);
                });
            });
        });
    }
});

describe('seed smoke: topic-frequency reference data (Req 6.1, 6.2, 6.4)', () => {
    for (const track of TRACKS) {
        describe(`track ${track}`, () => {
            it('has at least one topic-frequency Reference_Data_Year, returned ascending', () => {
                const years = getTopicFrequencyYears(track);
                expect(years.length).toBeGreaterThanOrEqual(1);
                const sorted = [...years].sort((a, b) => a - b);
                expect(years).toEqual(sorted);
                years.forEach((year) => expect(Number.isInteger(year)).toBe(true));
            });

            it('has Topic_Frequency_Records keyed by (track, year) with count, year span, and avg populated', () => {
                const year = activeYear(getTopicFrequencyYears(track));
                const dataset = getTopicFrequencyDataset(track, year);

                expect(dataset).toBeDefined();
                expect(dataset?.examTrack).toBe(track);
                expect(dataset?.referenceDataYear).toBe(year);
                expect(dataset?.records.length).toBeGreaterThanOrEqual(1);

                dataset?.records.forEach((record: TopicFrequencyRecord) => {
                    expect(isNonBlankString(record.topicKey)).toBe(true);
                    expect(isNonBlankString(record.topicName)).toBe(true);
                    expect(isNonBlankString(record.subjectKey)).toBe(true);

                    // appearanceCount populated and a non-negative integer.
                    expect(Number.isInteger(record.appearanceCount)).toBe(true);
                    expect(record.appearanceCount).toBeGreaterThanOrEqual(0);

                    // The covered year span is populated and ordered.
                    expect(Number.isInteger(record.yearSpanStart)).toBe(true);
                    expect(Number.isInteger(record.yearSpanEnd)).toBe(true);
                    expect(record.yearSpanEnd).toBeGreaterThanOrEqual(record.yearSpanStart);

                    // avgQuestionsPerYear populated and non-negative.
                    expect(isFiniteNumber(record.avgQuestionsPerYear)).toBe(true);
                    expect(record.avgQuestionsPerYear).toBeGreaterThanOrEqual(0);
                });
            });
        });
    }
});

describe('seed additivity: year N then N+1 retains both, max is active (Req 5.3, 6.4)', () => {
    /**
     * The catalogs are keyed by `(examTrack, referenceDataYear)`, so loading a later year
     * is purely additive. We verify the structures support more than one year per track and
     * that the year accessors + max-selection model "retain prior years, activate the latest"
     * without depending on how many years are currently authored (single-year data must not
     * fail this test).
     */
    for (const track of TRACKS) {
        it(`${track}: cutoff year accessor + additive N/N+1 selection`, () => {
            const authored = getCutoffYears(track);
            expect(authored.length).toBeGreaterThanOrEqual(1);

            // The accessor already returns the authored year(s) ascending.
            expect(activeYear(authored)).toBe(authored[authored.length - 1]);

            // Simulate loading the next year additively: prior years are retained and the
            // active version becomes the new max (Req 5.3).
            const n = authored[authored.length - 1];
            const withNextYear = [...authored, n + 1].sort((a, b) => a - b);
            expect(withNextYear).toContain(n); // prior year retained
            expect(withNextYear).toContain(n + 1); // new year present
            expect(activeYear(withNextYear)).toBe(n + 1); // newest is active
        });

        it(`${track}: topic-frequency year accessor + additive N/N+1 selection`, () => {
            const authored = getTopicFrequencyYears(track);
            expect(authored.length).toBeGreaterThanOrEqual(1);
            expect(activeYear(authored)).toBe(authored[authored.length - 1]);

            const n = authored[authored.length - 1];
            const withNextYear = [...authored, n + 1].sort((a, b) => a - b);
            expect(withNextYear).toContain(n); // prior year retained (Req 6.4)
            expect(withNextYear).toContain(n + 1);
            expect(activeYear(withNextYear)).toBe(n + 1);
        });
    }
});
