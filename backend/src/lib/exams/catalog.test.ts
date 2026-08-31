import { describe, expect, it } from 'vitest';

import {
    EXAM_PROGRAM_CATALOG,
    EXAM_PROGRAM_KEYS,
    getAllProgramSubjects,
    getExamProgram,
    findPaperDefinition,
    getPapersForStage,
    getSubjectsForStage,
} from './catalog';

describe('UPSC/SSC exam program catalog', () => {
    it('exposes the two first-launch programs without a family-specific branch', () => {
        expect(EXAM_PROGRAM_KEYS).toEqual(['UPSC_CSE', 'SSC_CGL']);
        expect(getExamProgram('UPSC_CSE').family).toBe('UPSC');
        expect(getExamProgram('SSC_CGL').family).toBe('SSC');
    });

    it('models UPSC prelims as two objective papers with CSAT qualifying', () => {
        const papers = getPapersForStage('UPSC_CSE', 'PRELIMS');
        expect(papers.map((paper) => paper.key)).toEqual([
            'UPSC-CSE-PRELIMS-GS1',
            'UPSC-CSE-PRELIMS-CSAT',
        ]);
        expect(papers[0].questionCount).toBe(100);
        expect(papers[1].qualifying).toBe(true);
        expect(papers[1].countForMerit).toBe(false);
    });

    it('models UPSC mains answer-writing papers separately from MCQ papers', () => {
        const papers = getPapersForStage('UPSC_CSE', 'MAINS');
        expect(papers).toHaveLength(9);
        expect(papers.slice(2).map((paper) => paper.name)).toEqual([
            'Paper I — Essay',
            'Paper II — General Studies 1',
            'Paper III — General Studies 2',
            'Paper IV — General Studies 3',
            'Paper V — General Studies 4',
            'Paper VI — Optional Subject 1',
            'Paper VII — Optional Subject 2',
        ]);
        expect(papers.every((paper) => paper.questionFormat === 'DESCRIPTIVE')).toBe(true);
        expect(papers.filter((paper) => paper.qualifying)).toHaveLength(2);
        expect(papers.filter((paper) => paper.countForMerit)).toHaveLength(7);
    });

    it('models SSC CGL tier sections and the optional statistics paper', () => {
        const papers = getPapersForStage('SSC_CGL', 'TIER_2');
        expect(papers.map((paper) => paper.key)).toEqual([
            'SSC-CGL-TIER2-PAPER1',
            'SSC-CGL-TIER2-PAPER2',
        ]);
        expect(papers[0].sections?.map((section) => section.key)).toContain('DATA_ENTRY_SPEED_TEST');
        expect(papers[0].questionCount).toBe(150);
        expect(papers[0].maxMarks).toBe(450);
        expect(papers[1].notes?.[0]).toMatch(/statistical posts/i);
    });

    it('resolves official year-suffixed keys to the canonical paper definition', () => {
        expect(findPaperDefinition('UPSC_CSE', 'PRELIMS', 'UPSC-CSE-PRELIMS-GS1-2024')?.questionCount).toBe(100);
        expect(findPaperDefinition('SSC_CGL', 'TIER_1', 'SSC-CGL-TIER1-2024')?.maxMarks).toBe(200);
        expect(findPaperDefinition('UPSC_CSE', 'MAINS', 'UPSC-CSE-MAINS-GS1-2024')?.questionFormat).toBe('DESCRIPTIVE');
        expect(findPaperDefinition('UPSC_CSE', 'PRELIMS', 'unknown-paper')).toBeUndefined();
    });

    it('keeps stage-specific syllabus units available for timetable generation', () => {
        expect(getSubjectsForStage('UPSC_CSE', 'PRELIMS').map((subject) => subject.key)).toEqual([
            'UPSC-CSE-GS1',
            'UPSC-CSE-CSAT',
        ]);
        expect(getSubjectsForStage('SSC_CGL', 'TIER_1')).toHaveLength(4);
        expect(EXAM_PROGRAM_CATALOG.SSC_CGL.officialSources).toEqual(
            expect.arrayContaining(['https://ssc.gov.in/api/attachment/uploads/masterData/Static/CGL.pdf']),
        );
    });

    it('produces globally unique seed keys for program subjects', () => {
        const subjects = getAllProgramSubjects();
        expect(new Set(subjects.map((subject) => subject.key)).size).toBe(subjects.length);
        expect(subjects.every((subject) => subject.program === 'UPSC_CSE' || subject.program === 'SSC_CGL')).toBe(true);
    });
});
