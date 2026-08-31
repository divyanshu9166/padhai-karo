import type {
    ExamFamily,
    ExamProgramDefinition,
    ExamProgramKey,
    ExamStage,
    NegativeMarking,
    PaperDefinition,
    PaperSectionDefinition,
    ProgramSubjectRecord,
    QuestionFormat,
    SyllabusSubjectDefinition,
} from './types';

const UPSC_PRELIMS_NEGATIVE: NegativeMarking = {
    kind: 'FRACTION_OF_QUESTION_MARKS',
    fraction: 1 / 3,
};

const SSC_TIER_1_NEGATIVE: NegativeMarking = { kind: 'FIXED_MARKS', marks: 0.5 };
const SSC_TIER_2_PAPER_1_NEGATIVE: NegativeMarking = { kind: 'FIXED_MARKS', marks: 1 };
const SSC_TIER_2_PAPER_2_NEGATIVE: NegativeMarking = { kind: 'FIXED_MARKS', marks: 0.5 };

const UPSC_PRELIMS_SUBJECTS: readonly SyllabusSubjectDefinition[] = [
    {
        key: 'UPSC-CSE-GS1',
        name: 'General Studies Paper I',
        stage: 'PRELIMS',
        planningPriority: 1,
        units: [
            'History of India and Indian National Movement',
            'Indian and World Geography',
            'Indian Polity and Governance',
            'Economic and Social Development',
            'Environment, Ecology, Biodiversity and Climate Change',
            'General Science',
            'Current Affairs of National and International Importance',
        ],
    },
    {
        key: 'UPSC-CSE-CSAT',
        name: 'General Studies Paper II (CSAT)',
        stage: 'PRELIMS',
        planningPriority: 1,
        units: [
            'Comprehension',
            'Interpersonal and Communication Skills',
            'Logical Reasoning and Analytical Ability',
            'Decision Making and Problem Solving',
            'General Mental Ability',
            'Basic Numeracy and Data Interpretation',
        ],
    },
];

const UPSC_MAINS_SUBJECTS: readonly SyllabusSubjectDefinition[] = [
    {
        key: 'UPSC-CSE-MAINS-LANGUAGE',
        name: 'Indian Language (Qualifying)',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Comprehension', 'Precis writing', 'Usage and vocabulary', 'Short essay', 'Translation practice'],
    },
    {
        key: 'UPSC-CSE-MAINS-ENGLISH',
        name: 'English (Qualifying)',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Comprehension', 'Precis writing', 'Usage and vocabulary', 'Short essay', 'Translation practice'],
    },
    {
        key: 'UPSC-CSE-MAINS-ESSAY',
        name: 'Essay',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Essay structure', 'Argument building', 'Examples and introductions', 'Timed essay practice'],
    },
    {
        key: 'UPSC-CSE-MAINS-GS1',
        name: 'General Studies I',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Indian heritage and culture', 'Modern and world history', 'Indian society', 'World geography'],
    },
    {
        key: 'UPSC-CSE-MAINS-GS2',
        name: 'General Studies II',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Constitution and polity', 'Governance', 'Social justice', 'International relations'],
    },
    {
        key: 'UPSC-CSE-MAINS-GS3',
        name: 'General Studies III',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Economy', 'Science and technology', 'Environment and biodiversity', 'Internal security', 'Disaster management'],
    },
    {
        key: 'UPSC-CSE-MAINS-GS4',
        name: 'General Studies IV (Ethics)',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Ethics and human interface', 'Attitude', 'Emotional intelligence', 'Probity in governance', 'Case studies'],
    },
    {
        key: 'UPSC-CSE-MAINS-OPTIONAL',
        name: 'Optional Subject',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Optional Paper I', 'Optional Paper II'],
    },
    {
        key: 'UPSC-CSE-MAINS-CURRENT-AFFAIRS',
        name: 'Current Affairs',
        stage: 'MAINS',
        planningPriority: 1,
        units: ['Daily current-affairs capture', 'Issue-wise notes', 'Editorial analysis', 'Answer enrichment examples'],
    },
];

const SSC_CGL_SUBJECTS: readonly SyllabusSubjectDefinition[] = [
    {
        key: 'SSC-CGL-REASONING',
        name: 'General Intelligence and Reasoning',
        stage: 'TIER_1',
        planningPriority: 1,
        units: ['Analogy', 'Classification', 'Series', 'Coding-decoding', 'Syllogism', 'Venn diagrams', 'Non-verbal reasoning'],
    },
    {
        key: 'SSC-CGL-GA',
        name: 'General Awareness',
        stage: 'TIER_1',
        planningPriority: 1,
        units: ['History', 'Geography', 'Polity', 'Economy', 'Science', 'Current Affairs'],
    },
    {
        key: 'SSC-CGL-QUANT',
        name: 'Quantitative Aptitude',
        stage: 'TIER_1',
        planningPriority: 1,
        units: ['Number systems', 'Arithmetic', 'Algebra', 'Geometry', 'Mensuration', 'Trigonometry', 'Data interpretation'],
    },
    {
        key: 'SSC-CGL-ENGLISH',
        name: 'English Comprehension',
        stage: 'TIER_1',
        planningPriority: 1,
        units: ['Vocabulary', 'Grammar', 'Reading comprehension', 'Cloze test', 'Sentence correction', 'Active/passive voice'],
    },
    {
        key: 'SSC-CGL-COMPUTER',
        name: 'Computer Knowledge',
        stage: 'TIER_2',
        planningPriority: 2,
        units: ['Computer basics', 'Operating systems', 'Internet and networking', 'Cyber security', 'Office applications'],
    },
    {
        key: 'SSC-CGL-STATISTICS',
        name: 'Statistics',
        stage: 'TIER_2',
        planningPriority: 3,
        units: ['Collection and presentation of data', 'Measures of central tendency', 'Measures of dispersion', 'Correlation and regression', 'Probability'],
    },
    {
        key: 'SSC-CGL-TIER2-MATHEMATICAL',
        name: 'Tier-II Mathematical Abilities',
        stage: 'TIER_2',
        planningPriority: 1,
        units: ['Number systems', 'Arithmetic', 'Algebra', 'Geometry', 'Mensuration', 'Trigonometry', 'Data interpretation'],
    },
    {
        key: 'SSC-CGL-TIER2-REASONING',
        name: 'Tier-II Reasoning and General Intelligence',
        stage: 'TIER_2',
        planningPriority: 1,
        units: ['Analogy', 'Classification', 'Series', 'Coding-decoding', 'Syllogism', 'Venn diagrams', 'Non-verbal reasoning'],
    },
    {
        key: 'SSC-CGL-TIER2-ENGLISH',
        name: 'Tier-II English Language and Comprehension',
        stage: 'TIER_2',
        planningPriority: 1,
        units: ['Vocabulary', 'Grammar', 'Reading comprehension', 'Cloze test', 'Sentence correction', 'Active/passive voice'],
    },
    {
        key: 'SSC-CGL-TIER2-GA',
        name: 'Tier-II General Awareness',
        stage: 'TIER_2',
        planningPriority: 1,
        units: ['History', 'Geography', 'Polity', 'Economy', 'Science', 'Current Affairs'],
    },
];

const UPSC_PRELIMS_PAPERS: readonly PaperDefinition[] = [
    {
        key: 'UPSC-CSE-PRELIMS-GS1',
        name: 'General Studies Paper I',
        stage: 'PRELIMS',
        sequence: 1,
        durationMin: 120,
        questionFormat: 'MCQ',
        questionCount: 100,
        maxMarks: 200,
        countForMerit: true,
        negativeMarking: UPSC_PRELIMS_NEGATIVE,
        notes: ['Objective paper. Used with the qualifying threshold in GS Paper II for the Prelims shortlist.'],
    },
    {
        key: 'UPSC-CSE-PRELIMS-CSAT',
        name: 'General Studies Paper II (CSAT)',
        stage: 'PRELIMS',
        sequence: 2,
        durationMin: 120,
        questionFormat: 'MCQ',
        questionCount: 80,
        maxMarks: 200,
        qualifying: true,
        countForMerit: false,
        negativeMarking: UPSC_PRELIMS_NEGATIVE,
        notes: ['Qualifying paper with a 33% minimum qualifying mark.'],
    },
];

const UPSC_MAINS_PAPERS: readonly PaperDefinition[] = [
    {
        key: 'UPSC-CSE-MAINS-LANGUAGE',
        name: 'Paper A — Indian Language',
        stage: 'MAINS',
        sequence: 1,
        durationMin: 180,
        questionFormat: 'DESCRIPTIVE',
        maxMarks: 300,
        qualifying: true,
        countForMerit: false,
        negativeMarking: { kind: 'NONE' },
    },
    {
        key: 'UPSC-CSE-MAINS-ENGLISH',
        name: 'Paper B — English',
        stage: 'MAINS',
        sequence: 2,
        durationMin: 180,
        questionFormat: 'DESCRIPTIVE',
        maxMarks: 300,
        qualifying: true,
        countForMerit: false,
        negativeMarking: { kind: 'NONE' },
    },
    ...(['ESSAY', 'GS1', 'GS2', 'GS3', 'GS4', 'OPTIONAL1', 'OPTIONAL2'] as const).map(
        (paperKey, index): PaperDefinition => ({
            key: `UPSC-CSE-MAINS-${paperKey}`,
            name:
                paperKey === 'ESSAY'
                    ? 'Paper I — Essay'
                    : paperKey.startsWith('GS')
                      ? `Paper ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][index]} — General Studies ${paperKey.slice(2)}`
                      : `Paper ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][index]} — Optional Subject ${paperKey.slice(-1)}`,
            stage: 'MAINS',
            sequence: index + 3,
            durationMin: 180,
            questionFormat: 'DESCRIPTIVE',
            maxMarks: 250,
            countForMerit: true,
            negativeMarking: { kind: 'NONE' },
            notes: ['Conventional essay-type paper; evaluation is supported through answer-writing practice rather than MCQ auto-scoring.'],
        }),
    ),
];

const SSC_TIER_1_SECTIONS: readonly PaperSectionDefinition[] = [
    { key: 'REASONING', name: 'General Intelligence and Reasoning', questionCount: 25, maxMarks: 50, questionFormat: 'MCQ', negativeMarking: SSC_TIER_1_NEGATIVE },
    { key: 'GENERAL_AWARENESS', name: 'General Awareness', questionCount: 25, maxMarks: 50, questionFormat: 'MCQ', negativeMarking: SSC_TIER_1_NEGATIVE },
    { key: 'QUANTITATIVE_APTITUDE', name: 'Quantitative Aptitude', questionCount: 25, maxMarks: 50, questionFormat: 'MCQ', negativeMarking: SSC_TIER_1_NEGATIVE },
    { key: 'ENGLISH_COMPREHENSION', name: 'English Comprehension', questionCount: 25, maxMarks: 50, questionFormat: 'MCQ', negativeMarking: SSC_TIER_1_NEGATIVE },
];

const SSC_TIER_2_PAPER_1_SECTIONS: readonly PaperSectionDefinition[] = [
    { key: 'MATHEMATICAL_ABILITIES', name: 'Mathematical Abilities', questionCount: 30, maxMarks: 90, durationMin: 60, questionFormat: 'MCQ', negativeMarking: SSC_TIER_2_PAPER_1_NEGATIVE },
    { key: 'REASONING', name: 'Reasoning and General Intelligence', questionCount: 30, maxMarks: 90, durationMin: 60, questionFormat: 'MCQ', negativeMarking: SSC_TIER_2_PAPER_1_NEGATIVE },
    { key: 'ENGLISH', name: 'English Language and Comprehension', questionCount: 45, maxMarks: 135, durationMin: 60, questionFormat: 'MCQ', negativeMarking: SSC_TIER_2_PAPER_1_NEGATIVE },
    { key: 'GENERAL_AWARENESS', name: 'General Awareness', questionCount: 25, maxMarks: 75, durationMin: 60, questionFormat: 'MCQ', negativeMarking: SSC_TIER_2_PAPER_1_NEGATIVE },
    { key: 'COMPUTER_KNOWLEDGE', name: 'Computer Knowledge Test', questionCount: 20, maxMarks: 60, durationMin: 15, questionFormat: 'MCQ', qualifying: true, negativeMarking: SSC_TIER_2_PAPER_1_NEGATIVE },
    { key: 'DATA_ENTRY_SPEED_TEST', name: 'Data Entry Speed Test', durationMin: 15, questionFormat: 'SKILL_TEST', qualifying: true, negativeMarking: { kind: 'NONE' } },
];

const SSC_CGL_PAPERS: readonly PaperDefinition[] = [
    {
        key: 'SSC-CGL-TIER1',
        name: 'Tier-I',
        stage: 'TIER_1',
        sequence: 1,
        durationMin: 60,
        questionFormat: 'MCQ',
        questionCount: 100,
        maxMarks: 200,
        negativeMarking: SSC_TIER_1_NEGATIVE,
        sections: [...SSC_TIER_1_SECTIONS],
        notes: ['Computer-based objective paper; English Comprehension is the language exception to the bilingual paper.'],
    },
    {
        key: 'SSC-CGL-TIER2-PAPER1',
        name: 'Tier-II Paper-I',
        stage: 'TIER_2',
        sequence: 2,
        durationMin: 150,
        questionFormat: 'MCQ',
        questionCount: 150,
        maxMarks: 450,
        negativeMarking: SSC_TIER_2_PAPER_1_NEGATIVE,
        sections: [...SSC_TIER_2_PAPER_1_SECTIONS],
        notes: ['Session I is 135 minutes and Session II DEST is 15 minutes; the app models them as separate timed sections.'],
    },
    {
        key: 'SSC-CGL-TIER2-PAPER2',
        name: 'Tier-II Paper-II — Statistics',
        stage: 'TIER_2',
        sequence: 3,
        durationMin: 120,
        questionFormat: 'MCQ',
        questionCount: 100,
        maxMarks: 200,
        negativeMarking: SSC_TIER_2_PAPER_2_NEGATIVE,
        notes: ['Applicable only to candidates shortlisted for the relevant statistical posts.'],
    },
];

export const EXAM_PROGRAM_CATALOG: Readonly<Record<ExamProgramKey, ExamProgramDefinition>> = {
    UPSC_CSE: {
        key: 'UPSC_CSE',
        family: 'UPSC',
        name: 'Civil Services Examination',
        shortName: 'UPSC CSE',
        stages: ['PRELIMS', 'MAINS'],
        papers: [...UPSC_PRELIMS_PAPERS, ...UPSC_MAINS_PAPERS],
        subjects: [...UPSC_PRELIMS_SUBJECTS, ...UPSC_MAINS_SUBJECTS],
        officialSources: [
            'https://www.upsc.gov.in/sites/default/files/Notif-CSP-2026-Engl-060226Rev.pdf',
            'https://upsc.gov.in/examinations/previous-question-papers',
        ],
    },
    SSC_CGL: {
        key: 'SSC_CGL',
        family: 'SSC',
        name: 'Combined Graduate Level Examination',
        shortName: 'SSC CGL',
        stages: ['TIER_1', 'TIER_2'],
        papers: SSC_CGL_PAPERS,
        subjects: SSC_CGL_SUBJECTS,
        officialSources: [
            'https://ssc.gov.in/api/attachment/uploads/masterData/Static/CGL.pdf',
            'https://ssc.gov.in/for-candidates',
        ],
    },
};

export const EXAM_PROGRAM_KEYS: readonly ExamProgramKey[] = ['UPSC_CSE', 'SSC_CGL'];

export function getExamProgram(key: ExamProgramKey): ExamProgramDefinition {
    return EXAM_PROGRAM_CATALOG[key];
}

export function getExamProgramsByFamily(family: ExamFamily): ExamProgramDefinition[] {
    return EXAM_PROGRAM_KEYS.filter((key) => EXAM_PROGRAM_CATALOG[key].family === family).map(
        (key) => EXAM_PROGRAM_CATALOG[key],
    );
}

export function getPapersForStage(
    programKey: ExamProgramKey,
    stage: ExamStage,
): PaperDefinition[] {
    return getExamProgram(programKey).papers.filter((paper) => paper.stage === stage);
}

/**
 * Resolve a stored paper key to the canonical scoring definition.
 *
 * Official imports carry a year/session suffix (for example
 * `UPSC-CSE-PRELIMS-GS1-2024`) while the catalog intentionally stores the
 * stable paper identity (`UPSC-CSE-PRELIMS-GS1`). Keeping this lookup in one
 * place prevents verified papers from being treated as unknown, and prevents
 * descriptive Mains papers from accidentally entering the MCQ mock flow.
 */
export function findPaperDefinition(
    programKey: ExamProgramKey,
    stage: ExamStage,
    storedPaperKey: string | null | undefined,
): PaperDefinition | undefined {
    const key = typeof storedPaperKey === 'string' ? storedPaperKey.trim() : '';
    if (!key) return undefined;
    return getPapersForStage(programKey, stage).find((paper) => key === paper.key || key.startsWith(`${paper.key}-`));
}

export function getSubjectsForStage(
    programKey: ExamProgramKey,
    stage: ExamStage,
): SyllabusSubjectDefinition[] {
    return getExamProgram(programKey).subjects.filter((subject) => subject.stage === stage);
}

export function getAllProgramSubjects(): ProgramSubjectRecord[] {
    return EXAM_PROGRAM_KEYS.flatMap((programKey) => {
        const program = getExamProgram(programKey);
        return program.subjects.map((subject) => ({
            key: subject.key,
            name: subject.name,
            family: program.family,
            program: program.key,
            stage: subject.stage,
        }));
    });
}

export {
    SSC_CGL_PAPERS,
    SSC_CGL_SUBJECTS,
    UPSC_MAINS_PAPERS,
    UPSC_MAINS_SUBJECTS,
    UPSC_PRELIMS_PAPERS,
    UPSC_PRELIMS_SUBJECTS,
};
