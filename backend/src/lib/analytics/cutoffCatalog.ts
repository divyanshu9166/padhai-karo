/**
 * Year-versioned cutoff and score-standing reference catalog (task 1.2).
 *
 * This is the system-supplied source of truth for two of the Performance Analytics
 * reference datasets, authored as plain TypeScript (mirroring the Phase 1
 * `lib/reference/catalog.ts` pattern) so it can be imported WITHOUT a live database
 * by:
 *
 *  - the Prisma seed script (`prisma/seed.ts`, task 1.5), which upserts these rows
 *    into the `CutoffReferenceData` and `ScoreStandingMap` tables by their natural
 *    keys, and
 *  - the active-version resolver / reference readers (task 2.1 onward), which select
 *    the most-recent `referenceDataYear` per `examTrack`.
 *
 * Two datasets live here because they are versioned together (the design notes the
 * percentile mapping is "defined in the active Cutoff_Reference_Data"):
 *
 *  1. CUTOFF_CATALOG — JoSAA (JEE) closing ranks and NEET counseling closing marks,
 *     one entry per (college, branch, category). Matches the Prisma
 *     `CutoffReferenceData` model field-for-field.
 *  2. SCORE_STANDING_CATALOG — the band mapping a normalized score percentage to an
 *     estimated standing band (JEE percentile / NEET marks), used by Rank_Prediction.
 *     Matches the Prisma `ScoreStandingMap` model field-for-field.
 *
 * Both are keyed by `(examTrack, referenceDataYear)`. Loading a later year is purely
 * additive — prior years' rows are retained — so multiple years can coexist and the
 * resolver picks the maximum year as active (Req 5.2, 5.3).
 *
 * The values below are representative, plausible, system-supplied seed content (closing
 * ranks/marks fluctuate yearly and per round); they are illustrative defaults a later
 * year's dataset replaces, not an authoritative reproduction of any single counseling
 * round.
 */
import type { ExamTrack } from '../reference';

/**
 * Mirrors the Prisma `CutoffUnit` enum (see prisma/schema.prisma). Declared structurally
 * here so this catalog never needs to import the generated Prisma client.
 *
 *  - `RANK`       — JoSAA closing rank (JEE), lower is better.
 *  - `PERCENTILE` — JEE Main percentile, higher is better.
 *  - `MARKS`      — NEET marks / score, higher is better.
 */
export type CutoffUnit = 'RANK' | 'PERCENTILE' | 'MARKS';

/**
 * A single Cutoff_Reference_Data entry — one (college, branch, category) closing value
 * for a track + year. Field names/types align with the Prisma `CutoffReferenceData`
 * model so the seed can upsert without remapping. The natural key is
 * `(examTrack, referenceDataYear, collegeName, branchName, category)`.
 */
export interface CutoffCatalogEntry {
    /** Display name of the institute (e.g. "IIT Bombay", "AIIMS New Delhi"). */
    collegeName: string;
    /** Branch / programme (e.g. "Computer Science & Engineering", "MBBS"). */
    branchName: string;
    /** Counseling category, e.g. General/OBC-NCL/SC/ST/EWS. */
    category: string;
    /** Closing value interpreted per `unit` (closing rank, percentile, or marks). */
    closingValue: number;
    /** Unit the `closingValue` is expressed in. */
    unit: CutoffUnit;
}

/**
 * A single Score_Standing_Map band — a normalized-score-percentage range mapped to an
 * estimated standing band. Field names/types align with the Prisma `ScoreStandingMap`
 * model. The natural key is `(examTrack, referenceDataYear, minScorePercent, maxScorePercent)`.
 *
 * Bands for a track+year are authored contiguous and exhaustive over the 0–100 score%
 * range so Rank_Prediction can always locate a containing band (and clamp out-of-range
 * inputs to the nearest one).
 */
export interface ScoreStandingBand {
    /** Inclusive lower bound of the normalized score % band. */
    minScorePercent: number;
    /** Inclusive upper bound of the normalized score % band. */
    maxScorePercent: number;
    /** Low end of the estimated standing band (in `unit`). */
    estimateLow: number;
    /** High end of the estimated standing band (in `unit`). estimateHigh >= estimateLow. */
    estimateHigh: number;
    /** Standing unit: PERCENTILE for JEE, MARKS for NEET. */
    unit: CutoffUnit;
}

// === Cutoff closing data =====================================================

// JoSAA (JEE) closing ranks — illustrative General-category closing ranks for flagship
// CSE/EE programmes plus a few categories at one institute to exercise category handling.
const JEE_CUTOFFS_2024: CutoffCatalogEntry[] = [
    { collegeName: 'IIT Bombay', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 67, unit: 'RANK' },
    { collegeName: 'IIT Bombay', branchName: 'Computer Science & Engineering', category: 'EWS', closingValue: 12, unit: 'RANK' },
    { collegeName: 'IIT Bombay', branchName: 'Computer Science & Engineering', category: 'OBC-NCL', closingValue: 28, unit: 'RANK' },
    { collegeName: 'IIT Bombay', branchName: 'Computer Science & Engineering', category: 'SC', closingValue: 9, unit: 'RANK' },
    { collegeName: 'IIT Bombay', branchName: 'Computer Science & Engineering', category: 'ST', closingValue: 4, unit: 'RANK' },
    { collegeName: 'IIT Delhi', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 118, unit: 'RANK' },
    { collegeName: 'IIT Delhi', branchName: 'Electrical Engineering', category: 'General', closingValue: 425, unit: 'RANK' },
    { collegeName: 'IIT Madras', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 159, unit: 'RANK' },
    { collegeName: 'IIT Kanpur', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 237, unit: 'RANK' },
    { collegeName: 'IIT Kharagpur', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 279, unit: 'RANK' },
    { collegeName: 'IIT Roorkee', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 433, unit: 'RANK' },
    { collegeName: 'NIT Tiruchirappalli', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 1240, unit: 'RANK' },
    { collegeName: 'NIT Surathkal', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 2150, unit: 'RANK' },
    { collegeName: 'IIIT Hyderabad', branchName: 'Computer Science & Engineering', category: 'General', closingValue: 850, unit: 'RANK' },
];

// NEET counseling closing marks (out of 720) — illustrative closing marks for MBBS at a
// spread of institutes, with categories at one institute to exercise category handling.
const NEET_CUTOFFS_2024: CutoffCatalogEntry[] = [
    { collegeName: 'AIIMS New Delhi', branchName: 'MBBS', category: 'General', closingValue: 705, unit: 'MARKS' },
    { collegeName: 'AIIMS New Delhi', branchName: 'MBBS', category: 'EWS', closingValue: 700, unit: 'MARKS' },
    { collegeName: 'AIIMS New Delhi', branchName: 'MBBS', category: 'OBC-NCL', closingValue: 698, unit: 'MARKS' },
    { collegeName: 'AIIMS New Delhi', branchName: 'MBBS', category: 'SC', closingValue: 680, unit: 'MARKS' },
    { collegeName: 'AIIMS New Delhi', branchName: 'MBBS', category: 'ST', closingValue: 672, unit: 'MARKS' },
    { collegeName: 'Maulana Azad Medical College, New Delhi', branchName: 'MBBS', category: 'General', closingValue: 690, unit: 'MARKS' },
    { collegeName: 'Lady Hardinge Medical College, New Delhi', branchName: 'MBBS', category: 'General', closingValue: 681, unit: 'MARKS' },
    { collegeName: 'Grant Medical College, Mumbai', branchName: 'MBBS', category: 'General', closingValue: 668, unit: 'MARKS' },
    { collegeName: 'Seth GS Medical College (KEM), Mumbai', branchName: 'MBBS', category: 'General', closingValue: 665, unit: 'MARKS' },
    { collegeName: 'Madras Medical College, Chennai', branchName: 'MBBS', category: 'General', closingValue: 655, unit: 'MARKS' },
    { collegeName: 'Bangalore Medical College', branchName: 'MBBS', category: 'General', closingValue: 648, unit: 'MARKS' },
    { collegeName: 'King George Medical University, Lucknow', branchName: 'MBBS', category: 'General', closingValue: 640, unit: 'MARKS' },
];

// === Score-to-standing bands =================================================

// JEE: normalized score % -> estimated JEE Main percentile band. Contiguous and
// exhaustive over 0–100 (higher score % => higher percentile).
const JEE_SCORE_STANDING_2024: ScoreStandingBand[] = [
    { minScorePercent: 0, maxScorePercent: 20, estimateLow: 0, estimateHigh: 50, unit: 'PERCENTILE' },
    { minScorePercent: 20, maxScorePercent: 40, estimateLow: 50, estimateHigh: 75, unit: 'PERCENTILE' },
    { minScorePercent: 40, maxScorePercent: 55, estimateLow: 75, estimateHigh: 88, unit: 'PERCENTILE' },
    { minScorePercent: 55, maxScorePercent: 70, estimateLow: 88, estimateHigh: 95, unit: 'PERCENTILE' },
    { minScorePercent: 70, maxScorePercent: 82, estimateLow: 95, estimateHigh: 98.5, unit: 'PERCENTILE' },
    { minScorePercent: 82, maxScorePercent: 92, estimateLow: 98.5, estimateHigh: 99.5, unit: 'PERCENTILE' },
    { minScorePercent: 92, maxScorePercent: 100, estimateLow: 99.5, estimateHigh: 100, unit: 'PERCENTILE' },
];

// NEET: normalized score % -> estimated NEET marks band (out of 720). Contiguous and
// exhaustive over 0–100 (higher score % => higher marks).
const NEET_SCORE_STANDING_2024: ScoreStandingBand[] = [
    { minScorePercent: 0, maxScorePercent: 20, estimateLow: 0, estimateHigh: 200, unit: 'MARKS' },
    { minScorePercent: 20, maxScorePercent: 40, estimateLow: 200, estimateHigh: 360, unit: 'MARKS' },
    { minScorePercent: 40, maxScorePercent: 55, estimateLow: 360, estimateHigh: 470, unit: 'MARKS' },
    { minScorePercent: 55, maxScorePercent: 70, estimateLow: 470, estimateHigh: 560, unit: 'MARKS' },
    { minScorePercent: 70, maxScorePercent: 82, estimateLow: 560, estimateHigh: 630, unit: 'MARKS' },
    { minScorePercent: 82, maxScorePercent: 92, estimateLow: 630, estimateHigh: 680, unit: 'MARKS' },
    { minScorePercent: 92, maxScorePercent: 100, estimateLow: 680, estimateHigh: 720, unit: 'MARKS' },
];

// === Catalogs keyed by (examTrack, referenceDataYear) ========================

/**
 * Cutoff_Reference_Data keyed by Exam_Track then Reference_Data_Year. At least one year
 * per track is provided; additional years can be added without removing prior years
 * (the resolver selects the maximum year as active — Req 5.2, 5.3).
 */
export const CUTOFF_CATALOG: Record<ExamTrack, Record<number, CutoffCatalogEntry[]>> = {
    JEE: {
        2024: JEE_CUTOFFS_2024,
    },
    NEET: {
        2024: NEET_CUTOFFS_2024,
    },
};

/**
 * Score_Standing_Map bands keyed by Exam_Track then Reference_Data_Year, versioned
 * alongside `CUTOFF_CATALOG`. Bands are contiguous and cover the full 0–100 score%
 * range so Rank_Prediction can always clamp to a band.
 */
export const SCORE_STANDING_CATALOG: Record<ExamTrack, Record<number, ScoreStandingBand[]>> = {
    JEE: {
        2024: JEE_SCORE_STANDING_2024,
    },
    NEET: {
        2024: NEET_SCORE_STANDING_2024,
    },
};

// === Accessors ===============================================================

/** Exam_Tracks the cutoff/score-standing catalog covers. */
export const CUTOFF_EXAM_TRACKS: ExamTrack[] = ['JEE', 'NEET'];

/** The Reference_Data_Years for which cutoff data exists for a track, ascending. */
export function getCutoffYears(track: ExamTrack): number[] {
    return Object.keys(CUTOFF_CATALOG[track])
        .map((y) => Number(y))
        .sort((a, b) => a - b);
}

/** The Reference_Data_Years for which score-standing data exists for a track, ascending. */
export function getScoreStandingYears(track: ExamTrack): number[] {
    return Object.keys(SCORE_STANDING_CATALOG[track])
        .map((y) => Number(y))
        .sort((a, b) => a - b);
}

/** Returns the cutoff entries for a track + year, or `[]` when none exist. */
export function getCutoffEntries(track: ExamTrack, year: number): CutoffCatalogEntry[] {
    return CUTOFF_CATALOG[track]?.[year] ?? [];
}

/** Returns the score-standing bands for a track + year, or `[]` when none exist. */
export function getScoreStandingBands(track: ExamTrack, year: number): ScoreStandingBand[] {
    return SCORE_STANDING_CATALOG[track]?.[year] ?? [];
}
