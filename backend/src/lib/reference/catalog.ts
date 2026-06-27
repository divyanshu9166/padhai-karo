/**
 * Track-keyed reference-data catalog (task 3.1).
 *
 * Subjects, chapters, and target exam dates for JEE and NEET, authored as plain
 * TypeScript so it can be imported without a database (by the onboarding service in
 * task 4.1, the read endpoints in task 3.2, and the Prisma seed in prisma/seed.ts).
 *
 * Weightage convention: each chapter's `weightage` is an approximate percentage of the
 * exam paper's marks. Per-track totals are designed to sum to ~100 so the timetable
 * engine (Req 11) can allocate time proportionally across both subjects and chapters.
 * The values reflect well-known JEE/NEET weightage patterns (e.g. JEE Calculus,
 * Mechanics, and Organic Chemistry carry high weightage; NEET Biology is ~50% of the
 * paper). They are representative, not an exhaustive NCERT syllabus, and are the seed
 * defaults a user can later override per chapter (Req 11.3/11.4).
 *
 * `referenceKey` values are stable and globally unique; onboarding copies them onto the
 * per-user `Chapter.referenceKey` so a chapter instance always links back to its catalog
 * row even after the catalog is revised.
 */
import type { ExamTrack, ReferenceChapter, ReferenceSubject } from './types';

// === JEE ====================================================================

const JEE_PHYSICS: ReferenceSubject = {
    key: 'JEE-PHYSICS',
    name: 'Physics',
    examTrack: 'JEE',
    chapters: [
        { referenceKey: 'JEE-PHY-MECHANICS', name: 'Mechanics (Laws of Motion, Work-Energy-Power)', weightage: 5.0, estimatedStudyHours: 14, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-ROTATION', name: 'Rotational Dynamics', weightage: 3.0, estimatedStudyHours: 10, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-KINEMATICS', name: 'Kinematics', weightage: 2.0, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-GRAVITATION', name: 'Gravitation', weightage: 1.5, estimatedStudyHours: 6, taskDifficulty: 'LIGHT' },
        { referenceKey: 'JEE-PHY-THERMODYNAMICS', name: 'Thermodynamics & Kinetic Theory', weightage: 3.0, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-OSCILLATIONS', name: 'Oscillations & Waves', weightage: 2.5, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-ELECTROSTATICS', name: 'Electrostatics', weightage: 3.0, estimatedStudyHours: 10, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-CURRENT', name: 'Current Electricity', weightage: 2.5, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-MAGNETISM', name: 'Magnetism & Electromagnetic Induction', weightage: 3.0, estimatedStudyHours: 11, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-OPTICS', name: 'Ray & Wave Optics', weightage: 3.0, estimatedStudyHours: 10, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-MODERN', name: 'Modern Physics', weightage: 3.3, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-PHY-UNITS', name: 'Units, Dimensions & Measurement', weightage: 1.0, estimatedStudyHours: 4, taskDifficulty: 'LIGHT' },
    ],
};

const JEE_CHEMISTRY: ReferenceSubject = {
    key: 'JEE-CHEMISTRY',
    name: 'Chemistry',
    examTrack: 'JEE',
    chapters: [
        { referenceKey: 'JEE-CHE-BASICS', name: 'Some Basic Concepts (Mole Concept)', weightage: 2.0, estimatedStudyHours: 5, taskDifficulty: 'LIGHT' },
        { referenceKey: 'JEE-CHE-ATOMIC', name: 'Atomic Structure', weightage: 2.0, estimatedStudyHours: 6, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-BONDING', name: 'Chemical Bonding & Molecular Structure', weightage: 3.0, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-THERMO', name: 'Thermodynamics & Thermochemistry', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-EQUILIBRIUM', name: 'Chemical & Ionic Equilibrium', weightage: 3.0, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-ELECTROCHEM', name: 'Electrochemistry', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-KINETICS', name: 'Chemical Kinetics', weightage: 2.0, estimatedStudyHours: 6, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-SOLUTIONS', name: 'Solutions & Colligative Properties', weightage: 2.0, estimatedStudyHours: 5, taskDifficulty: 'LIGHT' },
        { referenceKey: 'JEE-CHE-GOC', name: 'Organic Chemistry — GOC & Isomerism', weightage: 3.0, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-HYDROCARBONS', name: 'Hydrocarbons & Oxygen-containing Compounds', weightage: 3.0, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-ORGANIC-N', name: 'Nitrogen Compounds, Biomolecules & Polymers', weightage: 2.5, estimatedStudyHours: 7, taskDifficulty: 'LIGHT' },
        { referenceKey: 'JEE-CHE-COORDINATION', name: 'Coordination Compounds', weightage: 2.8, estimatedStudyHours: 7, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-CHE-PBLOCK', name: 'p-Block & Periodic Properties', weightage: 3.0, estimatedStudyHours: 7, taskDifficulty: 'LIGHT' },
    ],
};

const JEE_MATHEMATICS: ReferenceSubject = {
    key: 'JEE-MATHEMATICS',
    name: 'Mathematics',
    examTrack: 'JEE',
    chapters: [
        { referenceKey: 'JEE-MAT-LIMITS', name: 'Calculus — Limits, Continuity & Differentiability', weightage: 3.0, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-AOD', name: 'Calculus — Application of Derivatives', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-INTEGRALS', name: 'Calculus — Definite & Indefinite Integrals', weightage: 3.5, estimatedStudyHours: 11, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-DIFFEQ', name: 'Differential Equations & Area Under Curves', weightage: 2.0, estimatedStudyHours: 6, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-COORD', name: 'Coordinate Geometry — Straight Lines & Circles', weightage: 3.0, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-CONICS', name: 'Conic Sections', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-QUADRATIC', name: 'Quadratic Equations & Complex Numbers', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-SEQUENCES', name: 'Sequences & Series', weightage: 2.0, estimatedStudyHours: 6, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-MATRICES', name: 'Matrices & Determinants', weightage: 2.5, estimatedStudyHours: 6, taskDifficulty: 'LIGHT' },
        { referenceKey: 'JEE-MAT-PNC', name: 'Permutations, Combinations & Binomial Theorem', weightage: 2.3, estimatedStudyHours: 7, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-PROBABILITY', name: 'Probability', weightage: 2.0, estimatedStudyHours: 6, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-TRIG', name: 'Trigonometry', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'JEE-MAT-VECTORS', name: 'Vectors & 3D Geometry', weightage: 3.0, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
    ],
};

// === NEET ===================================================================

const NEET_PHYSICS: ReferenceSubject = {
    key: 'NEET-PHYSICS',
    name: 'Physics',
    examTrack: 'NEET',
    chapters: [
        { referenceKey: 'NEET-PHY-MECHANICS', name: 'Mechanics (Laws of Motion, Work-Energy-Power)', weightage: 4.0, estimatedStudyHours: 12, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-ROTATION', name: 'Rotational Motion', weightage: 2.0, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-THERMODYNAMICS', name: 'Thermodynamics & Kinetic Theory', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-OSCILLATIONS', name: 'Oscillations & Waves', weightage: 2.0, estimatedStudyHours: 7, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-ELECTROSTATICS', name: 'Electrostatics & Capacitance', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-CURRENT', name: 'Current Electricity', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-MAGNETISM', name: 'Magnetism, EMI & Alternating Current', weightage: 3.0, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-OPTICS', name: 'Ray & Wave Optics', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-MODERN', name: 'Modern Physics & Electronic Devices', weightage: 2.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-PHY-MATTER', name: 'Gravitation & Properties of Matter', weightage: 1.0, estimatedStudyHours: 5, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-PHY-UNITS', name: 'Units & Measurement', weightage: 0.5, estimatedStudyHours: 3, taskDifficulty: 'LIGHT' },
    ],
};

const NEET_CHEMISTRY: ReferenceSubject = {
    key: 'NEET-CHEMISTRY',
    name: 'Chemistry',
    examTrack: 'NEET',
    chapters: [
        { referenceKey: 'NEET-CHE-BASICS', name: 'Some Basic Concepts & Mole Concept', weightage: 1.5, estimatedStudyHours: 4, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-CHE-ATOMIC', name: 'Atomic Structure', weightage: 1.5, estimatedStudyHours: 5, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-CHE-BONDING', name: 'Chemical Bonding & Molecular Structure', weightage: 2.5, estimatedStudyHours: 7, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-CHE-THERMO', name: 'Thermodynamics', weightage: 2.0, estimatedStudyHours: 6, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-CHE-EQUILIBRIUM', name: 'Equilibrium', weightage: 2.0, estimatedStudyHours: 6, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-CHE-ELECTROCHEM', name: 'Electrochemistry & Redox Reactions', weightage: 1.5, estimatedStudyHours: 5, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-CHE-KINETICS', name: 'Chemical Kinetics', weightage: 1.5, estimatedStudyHours: 5, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-CHE-SOLUTIONS', name: 'Solutions & States of Matter', weightage: 1.5, estimatedStudyHours: 5, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-CHE-ORGANIC-1', name: 'Organic Chemistry — GOC & Hydrocarbons', weightage: 3.0, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-CHE-ORGANIC-2', name: 'Oxygen & Nitrogen Compounds, Biomolecules', weightage: 3.0, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-CHE-COORDINATION', name: 'Coordination Compounds & d/f-Block', weightage: 2.5, estimatedStudyHours: 6, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-CHE-PBLOCK', name: 'p-Block & Periodic Table', weightage: 2.5, estimatedStudyHours: 6, taskDifficulty: 'LIGHT' },
    ],
};

const NEET_BIOLOGY: ReferenceSubject = {
    key: 'NEET-BIOLOGY',
    name: 'Biology',
    examTrack: 'NEET',
    chapters: [
        { referenceKey: 'NEET-BIO-CELL', name: 'Cell Structure & Function', weightage: 3.0, estimatedStudyHours: 7, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-BIO-PLANT-PHYS', name: 'Plant Physiology', weightage: 4.0, estimatedStudyHours: 9, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-BIO-HUMAN-PHYS', name: 'Human Physiology', weightage: 7.0, estimatedStudyHours: 14, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-BIO-GENETICS', name: 'Genetics & Evolution', weightage: 6.0, estimatedStudyHours: 12, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-BIO-MOLECULAR', name: 'Molecular Basis of Inheritance', weightage: 3.5, estimatedStudyHours: 8, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-BIO-WELFARE', name: 'Biology in Human Welfare', weightage: 2.5, estimatedStudyHours: 6, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-BIO-BIOTECH', name: 'Biotechnology & its Applications', weightage: 4.0, estimatedStudyHours: 9, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-BIO-ECOLOGY', name: 'Ecology & Environment', weightage: 5.0, estimatedStudyHours: 10, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-BIO-REPRODUCTION', name: 'Reproduction (Plant & Human)', weightage: 4.5, estimatedStudyHours: 10, taskDifficulty: 'HARD' },
        { referenceKey: 'NEET-BIO-DIVERSITY', name: 'Diversity in the Living World', weightage: 3.5, estimatedStudyHours: 8, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-BIO-STRUCTURAL', name: 'Structural Organisation in Plants & Animals', weightage: 2.5, estimatedStudyHours: 6, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-BIO-MORPHOLOGY', name: 'Morphology & Anatomy of Flowering Plants', weightage: 2.0, estimatedStudyHours: 5, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-BIO-ANIMAL-KINGDOM', name: 'Animal Kingdom & Biological Classification', weightage: 1.5, estimatedStudyHours: 5, taskDifficulty: 'LIGHT' },
        { referenceKey: 'NEET-BIO-CELL-CYCLE', name: 'Cell Cycle & Biomolecules', weightage: 1.0, estimatedStudyHours: 4, taskDifficulty: 'LIGHT' },
    ],
};

/**
 * The full reference catalog keyed by Exam_Track.
 *
 * JEE = Physics, Chemistry, Mathematics. NEET = Physics, Chemistry, Biology
 * (Req 2.4). Ordering is stable and intentional (it is the order subjects/chapters
 * are presented and seeded in).
 */
export const REFERENCE_CATALOG: Record<ExamTrack, ReferenceSubject[]> = {
    JEE: [JEE_PHYSICS, JEE_CHEMISTRY, JEE_MATHEMATICS],
    NEET: [NEET_PHYSICS, NEET_CHEMISTRY, NEET_BIOLOGY],
};

/**
 * Representative Target_Exam_Date per Exam_Track and target attempt year, as ISO
 * date strings (UTC midnight). JEE Main is held in early April and NEET in early May;
 * these are reasonable placeholders that the NTA ingestion feed updates once official
 * dates are published (Req 20.6 / design "Reference Data Service").
 */
export const TARGET_EXAM_DATES: Record<ExamTrack, Record<number, string>> = {
    JEE: {
        2026: '2026-04-08',
        2027: '2027-04-07',
        2028: '2028-04-12',
        2029: '2029-04-09',
        2030: '2030-04-08',
    },
    NEET: {
        2026: '2026-05-03',
        2027: '2027-05-02',
        2028: '2028-05-07',
        2029: '2029-05-06',
        2030: '2030-05-05',
    },
};

// === Accessors ==============================================================

/** All Exam_Tracks the catalog covers. */
export const EXAM_TRACKS: ExamTrack[] = ['JEE', 'NEET'];

/** Returns the subjects (with chapters) for an Exam_Track (Req 2.4, 2.7). */
export function getSubjects(track: ExamTrack): ReferenceSubject[] {
    return REFERENCE_CATALOG[track];
}

/**
 * Returns every canonical chapter for an Exam_Track, flattened and annotated with the
 * owning subject key/name. Used by onboarding (task 4.1) to instantiate per-user
 * `Chapter` rows and by the read endpoints (task 3.2).
 */
export function getChapters(
    track: ExamTrack,
): Array<ReferenceChapter & { subjectKey: string; subjectName: string }> {
    return REFERENCE_CATALOG[track].flatMap((subject) =>
        subject.chapters.map((chapter) => ({
            ...chapter,
            subjectKey: subject.key,
            subjectName: subject.name,
        })),
    );
}

/** All subjects across every track (used by the seed). */
export function getAllSubjects(): ReferenceSubject[] {
    return EXAM_TRACKS.flatMap((track) => REFERENCE_CATALOG[track]);
}

/**
 * Returns the Target_Exam_Date for a track/year as a `Date`, or `undefined` when the
 * catalog has no representative date for that year.
 */
export function getExamDate(track: ExamTrack, year: number): Date | undefined {
    const iso = TARGET_EXAM_DATES[track]?.[year];
    return iso === undefined ? undefined : new Date(`${iso}T00:00:00.000Z`);
}

/** The years for which a representative Target_Exam_Date exists for a track. */
export function getExamYears(track: ExamTrack): number[] {
    return Object.keys(TARGET_EXAM_DATES[track])
        .map((y) => Number(y))
        .sort((a, b) => a - b);
}
