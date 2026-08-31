/**
 * Generic exam-program vocabulary used by the UPSC/SSC pivot.
 *
 * The existing JEE/NEET implementation stores one `ExamTrack` everywhere. UPSC and
 * SSC need one more level of detail: a family has multiple programs, stages/tiers,
 * papers, sections, and scoring rules. These types keep that structure explicit so
 * timetable, practice, and onboarding code do not have to infer it from display names.
 */

export type ExamFamily = 'UPSC' | 'SSC';

/** First launch programs; more SSC programs can be added without changing the model. */
export type ExamProgramKey = 'UPSC_CSE' | 'SSC_CGL';

export type ExamStage = 'PRELIMS' | 'MAINS' | 'TIER_1' | 'TIER_2';

export type QuestionFormat = 'MCQ' | 'DESCRIPTIVE' | 'SKILL_TEST';

export type NegativeMarking =
    | { kind: 'NONE' }
    | { kind: 'FIXED_MARKS'; marks: number }
    | { kind: 'FRACTION_OF_QUESTION_MARKS'; fraction: number };

export interface PaperSectionDefinition {
    key: string;
    name: string;
    questionCount?: number;
    maxMarks?: number;
    durationMin?: number;
    questionFormat: QuestionFormat;
    qualifying?: boolean;
    negativeMarking?: NegativeMarking;
}

export interface PaperDefinition {
    key: string;
    name: string;
    stage: ExamStage;
    sequence: number;
    durationMin: number;
    questionFormat: QuestionFormat;
    questionCount?: number;
    maxMarks?: number;
    qualifying?: boolean;
    countForMerit?: boolean;
    negativeMarking: NegativeMarking;
    sections?: PaperSectionDefinition[];
    notes?: readonly string[];
}

export interface SyllabusSubjectDefinition {
    key: string;
    name: string;
    stage: ExamStage;
    /** Relative planning priority; this is not presented as an official marks claim. */
    planningPriority: number;
    units: readonly string[];
}

export interface ExamProgramDefinition {
    key: ExamProgramKey;
    family: ExamFamily;
    name: string;
    shortName: string;
    stages: readonly ExamStage[];
    papers: readonly PaperDefinition[];
    subjects: readonly SyllabusSubjectDefinition[];
    officialSources: readonly string[];
}

/** Seed-ready subject row for the relational reference catalog. */
export interface ProgramSubjectRecord {
    key: string;
    name: string;
    family: ExamFamily;
    program: ExamProgramKey;
    stage: ExamStage;
}
