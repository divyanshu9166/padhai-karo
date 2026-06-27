import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
    EXAM_TRACKS,
    REFERENCE_CATALOG,
    getAllSubjects,
    getChapters,
    getExamDate,
    getExamYears,
    getSubjects,
} from './catalog';
import type { ExamTrack, ReferenceChapter } from './types';

/**
 * Unit + property tests for the track-keyed reference catalog (task 3.1).
 *
 * These exercise the plain TypeScript data module directly — no database required.
 * They guard the catalog's integrity invariants that the onboarding service (task 4.1),
 * the read endpoints (task 3.2), and the timetable engine (Req 11/12/13) rely on.
 */

const VALID_DIFFICULTIES = new Set(['HARD', 'LIGHT']);
const EXPECTED_SUBJECTS: Record<ExamTrack, string[]> = {
    JEE: ['Physics', 'Chemistry', 'Mathematics'],
    NEET: ['Physics', 'Chemistry', 'Biology'],
};

function allChapters(): ReferenceChapter[] {
    return EXAM_TRACKS.flatMap((track) => getChapters(track));
}

describe('reference catalog — subjects per track (Req 2.4)', () => {
    it('JEE has exactly Physics, Chemistry, Mathematics', () => {
        expect(getSubjects('JEE').map((s) => s.name)).toEqual(EXPECTED_SUBJECTS.JEE);
    });

    it('NEET has exactly Physics, Chemistry, Biology', () => {
        expect(getSubjects('NEET').map((s) => s.name)).toEqual(EXPECTED_SUBJECTS.NEET);
    });

    it('every subject is tagged with its own exam track', () => {
        for (const track of EXAM_TRACKS) {
            for (const subject of getSubjects(track)) {
                expect(subject.examTrack).toBe(track);
            }
        }
    });

    it('subject keys are globally unique', () => {
        const keys = getAllSubjects().map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('reference catalog — chapter integrity (Req 11, 12.6, 13)', () => {
    it('every chapter has a positive weightage', () => {
        for (const chapter of allChapters()) {
            expect(chapter.weightage).toBeGreaterThan(0);
        }
    });

    it('every chapter has positive estimated study hours (Req 12.6)', () => {
        for (const chapter of allChapters()) {
            expect(chapter.estimatedStudyHours).toBeGreaterThan(0);
        }
    });

    it('every chapter has a valid Task_Difficulty (Req 13)', () => {
        for (const chapter of allChapters()) {
            expect(VALID_DIFFICULTIES.has(chapter.taskDifficulty)).toBe(true);
        }
    });

    it('chapter referenceKeys are globally unique and non-empty', () => {
        const keys = allChapters().map((c) => c.referenceKey);
        expect(new Set(keys).size).toBe(keys.length);
        for (const key of keys) {
            expect(key.trim().length).toBeGreaterThan(0);
        }
    });

    it('chapter names are non-empty', () => {
        for (const chapter of allChapters()) {
            expect(chapter.name.trim().length).toBeGreaterThan(0);
        }
    });

    it('each subject provides a solid chapter set (8–15 chapters)', () => {
        for (const subject of getAllSubjects()) {
            expect(subject.chapters.length).toBeGreaterThanOrEqual(8);
            expect(subject.chapters.length).toBeLessThanOrEqual(15);
        }
    });
});

describe('reference catalog — weightage patterns (Req 11.1)', () => {
    function trackWeightageTotal(track: ExamTrack): number {
        return getChapters(track).reduce((sum, c) => sum + c.weightage, 0);
    }

    function subjectWeightageTotal(track: ExamTrack, subjectName: string): number {
        const subject = getSubjects(track).find((s) => s.name === subjectName);
        return (subject?.chapters ?? []).reduce((sum, c) => sum + c.weightage, 0);
    }

    it('per-track total weightage normalizes to roughly 100', () => {
        for (const track of EXAM_TRACKS) {
            const total = trackWeightageTotal(track);
            expect(total).toBeGreaterThanOrEqual(95);
            expect(total).toBeLessThanOrEqual(105);
        }
    });

    it('NEET Biology is the dominant subject (~50% of the paper)', () => {
        const bio = subjectWeightageTotal('NEET', 'Biology');
        const phys = subjectWeightageTotal('NEET', 'Physics');
        const chem = subjectWeightageTotal('NEET', 'Chemistry');

        expect(bio).toBeGreaterThan(phys);
        expect(bio).toBeGreaterThan(chem);
        // Biology should sit near half the paper.
        expect(bio).toBeGreaterThanOrEqual(45);
        expect(bio).toBeLessThanOrEqual(55);
    });

    it('JEE distributes weightage roughly evenly across its three subjects', () => {
        const totals = EXPECTED_SUBJECTS.JEE.map((name) => subjectWeightageTotal('JEE', name));
        for (const total of totals) {
            // Each of the three subjects carries ~1/3 of the paper.
            expect(total).toBeGreaterThanOrEqual(28);
            expect(total).toBeLessThanOrEqual(38);
        }
    });
});

describe('reference catalog — target exam dates (Req 14.6, 20.6)', () => {
    it('provides a representative exam date for each track and year', () => {
        for (const track of EXAM_TRACKS) {
            const years = getExamYears(track);
            expect(years.length).toBeGreaterThan(0);
            for (const year of years) {
                const date = getExamDate(track, year);
                expect(date).toBeInstanceOf(Date);
                expect(Number.isNaN(date!.getTime())).toBe(false);
            }
        }
    });

    it('exam dates fall in the expected month and matching year', () => {
        for (const track of EXAM_TRACKS) {
            // JEE Main ~ April (month index 3), NEET ~ May (month index 4).
            const expectedMonth = track === 'JEE' ? 3 : 4;
            for (const year of getExamYears(track)) {
                const date = getExamDate(track, year)!;
                expect(date.getUTCMonth()).toBe(expectedMonth);
                expect(date.getUTCFullYear()).toBe(year);
            }
        }
    });

    it('returns undefined for a year with no representative date', () => {
        expect(getExamDate('JEE', 1900)).toBeUndefined();
    });
});

describe('reference catalog — property-based integrity', () => {
    it('every chapter returned for any track satisfies all field invariants', () => {
        fc.assert(
            fc.property(fc.constantFrom(...EXAM_TRACKS), (track) => {
                const chapters = getChapters(track);
                return chapters.every(
                    (c) =>
                        c.weightage > 0 &&
                        c.estimatedStudyHours > 0 &&
                        VALID_DIFFICULTIES.has(c.taskDifficulty) &&
                        c.referenceKey.trim().length > 0 &&
                        c.name.trim().length > 0,
                );
            }),
        );
    });

    it('getSubjects always returns subjects belonging to the requested track', () => {
        fc.assert(
            fc.property(fc.constantFrom(...EXAM_TRACKS), (track) =>
                getSubjects(track).every((s) => s.examTrack === track),
            ),
        );
    });

    it('getExamDate is consistent with getExamYears for every known year', () => {
        fc.assert(
            fc.property(fc.constantFrom(...EXAM_TRACKS), (track) => {
                const years = getExamYears(track);
                return years.every((year) => {
                    const date = getExamDate(track, year);
                    return date instanceof Date && date.getUTCFullYear() === year;
                });
            }),
        );
    });
});
