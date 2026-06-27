/**
 * Unit (example) tests for STEP 8 — subject interleaving / anti-block scheduling
 * (Req 17.1, 17.2, 17.3, 17.4). DB-independent.
 *
 * Property 16 (task 6.17) covers the universal interleaving bound separately; these are
 * example/edge-case tests for the checker and the arranger.
 */
import { describe, expect, it } from 'vitest';

import {
    ExamTrack,
    JEE_INTERLEAVE_SUBJECTS,
    MAX_CONSECUTIVE_SUBJECT_MINUTES,
    NEET_INTERLEAVE_SUBJECTS,
    distinctSubjectCount,
    interleaveBlocks,
    interleaveSubjectsForTrack,
    maxConsecutiveSubjectMinutes,
    violatesInterleaving,
    type InterleaveUnit,
} from './interleave';

/** Helper: build a list of `count` blocks for one subject, each `durationMinutes` long. */
function blocks(subjectId: string, count: number, durationMinutes = 60): InterleaveUnit[] {
    return Array.from({ length: count }, () => ({ subjectId, durationMinutes }));
}

/** Helper: extract just the subject order of a sequence. */
function order(sequence: ReadonlyArray<InterleaveUnit>): string[] {
    return sequence.map((unit) => unit.subjectId);
}

describe('interleaveSubjectsForTrack (Req 17.2 / 17.3)', () => {
    it('JEE interleaves Physics, Mathematics, Chemistry', () => {
        expect(interleaveSubjectsForTrack(ExamTrack.JEE)).toEqual([
            'Physics',
            'Mathematics',
            'Chemistry',
        ]);
        expect(JEE_INTERLEAVE_SUBJECTS).toEqual(['Physics', 'Mathematics', 'Chemistry']);
    });

    it('NEET interleaves Biology, Physics, Chemistry', () => {
        expect(interleaveSubjectsForTrack(ExamTrack.NEET)).toEqual([
            'Biology',
            'Physics',
            'Chemistry',
        ]);
        expect(NEET_INTERLEAVE_SUBJECTS).toEqual(['Biology', 'Physics', 'Chemistry']);
    });
});

describe('maxConsecutiveSubjectMinutes', () => {
    it('is zero for an empty sequence', () => {
        expect(maxConsecutiveSubjectMinutes([])).toBe(0);
    });

    it('sums consecutive same-subject minutes and resets on a different subject', () => {
        const sequence: InterleaveUnit[] = [
            { subjectId: 'A', durationMinutes: 60 },
            { subjectId: 'A', durationMinutes: 60 }, // A run = 120
            { subjectId: 'B', durationMinutes: 30 }, // intervening, resets
            { subjectId: 'A', durationMinutes: 90 }, // A run = 90
        ];
        expect(maxConsecutiveSubjectMinutes(sequence)).toBe(120);
    });

    it('treats a non-adjacent repeat as a fresh run', () => {
        const sequence: InterleaveUnit[] = [
            { subjectId: 'A', durationMinutes: 90 },
            { subjectId: 'B', durationMinutes: 90 },
            { subjectId: 'A', durationMinutes: 90 },
        ];
        expect(maxConsecutiveSubjectMinutes(sequence)).toBe(90);
    });
});

describe('distinctSubjectCount', () => {
    it('counts unique subjects', () => {
        expect(distinctSubjectCount([])).toBe(0);
        expect(distinctSubjectCount(blocks('A', 3))).toBe(1);
        expect(distinctSubjectCount([...blocks('A', 2), ...blocks('B', 1)])).toBe(2);
    });
});

describe('violatesInterleaving (checker, Req 17.1 / 17.4)', () => {
    it('flags a sequence where a subject exceeds 120 consecutive minutes', () => {
        const violating: InterleaveUnit[] = [
            { subjectId: 'A', durationMinutes: 90 },
            { subjectId: 'A', durationMinutes: 60 }, // run = 150 > 120
            { subjectId: 'B', durationMinutes: 60 },
        ];
        expect(violatesInterleaving(violating)).toBe(true);
    });

    it('does not flag a sequence where every run is at most 120 minutes', () => {
        const ok: InterleaveUnit[] = [
            { subjectId: 'A', durationMinutes: 120 }, // exactly 120 is allowed
            { subjectId: 'B', durationMinutes: 120 },
            { subjectId: 'A', durationMinutes: 60 },
        ];
        expect(violatesInterleaving(ok)).toBe(false);
    });

    it('treats 120 minutes as allowed and 121 as a violation (boundary)', () => {
        expect(
            violatesInterleaving([
                { subjectId: 'A', durationMinutes: 120 },
                { subjectId: 'B', durationMinutes: 30 },
            ]),
        ).toBe(false);
        expect(
            violatesInterleaving([
                { subjectId: 'A', durationMinutes: 121 },
                { subjectId: 'B', durationMinutes: 30 },
            ]),
        ).toBe(true);
    });

    it('never flags a single-subject sequence regardless of length (Req 17.4)', () => {
        // 5 hours of one subject straight — exempt because only one subject is present.
        expect(violatesInterleaving(blocks('A', 10, 30))).toBe(false);
    });

    it('honors a custom bound', () => {
        const sequence: InterleaveUnit[] = [
            { subjectId: 'A', durationMinutes: 60 },
            { subjectId: 'A', durationMinutes: 30 }, // run = 90
            { subjectId: 'B', durationMinutes: 30 },
        ];
        expect(violatesInterleaving(sequence, 60)).toBe(true);
        expect(violatesInterleaving(sequence, 90)).toBe(false);
    });
});

describe('interleaveBlocks — single-subject exception (Req 17.4)', () => {
    it('returns a single subject in its original order, unconstrained', () => {
        const units = blocks('A', 6, 60); // 6 hours straight
        const result = interleaveBlocks(units);
        expect(order(result)).toEqual(['A', 'A', 'A', 'A', 'A', 'A']);
        // The constraint is skipped, so a long single-subject run is allowed.
        expect(maxConsecutiveSubjectMinutes(result)).toBe(360);
        expect(violatesInterleaving(result)).toBe(false);
    });

    it('returns an empty array unchanged', () => {
        expect(interleaveBlocks([])).toEqual([]);
    });

    it('preserves the input unit references without mutation', () => {
        const units = blocks('A', 3, 30);
        const snapshot = [...units];
        const result = interleaveBlocks(units);
        expect(units).toEqual(snapshot); // input not mutated
        result.forEach((unit, i) => expect(unit).toBe(units[i]));
    });
});

describe('interleaveBlocks — multi-subject bound (Req 17.1)', () => {
    it('keeps every run within 120 minutes when subjects are balanced', () => {
        const units = [...blocks('Physics', 4, 60), ...blocks('Chemistry', 4, 60)];
        const result = interleaveBlocks(units, {
            subjectPriority: ['Physics', 'Chemistry'],
        });
        expect(result).toHaveLength(8);
        expect(maxConsecutiveSubjectMinutes(result)).toBeLessThanOrEqual(
            MAX_CONSECUTIVE_SUBJECT_MINUTES,
        );
        expect(violatesInterleaving(result)).toBe(false);
    });

    it('breaks up a dominant subject with the minority subject before the bound is exceeded', () => {
        // Physics has 5x30 = 150 min; Chemistry has a single 30-min block.
        const units = [...blocks('Physics', 5, 30), ...blocks('Chemistry', 1, 30)];
        const result = interleaveBlocks(units, {
            subjectPriority: ['Physics', 'Chemistry'],
        });
        // 4x30 = 120 Physics blocks, then Chemistry intervenes, then the last Physics block.
        expect(order(result)).toEqual([
            'Physics',
            'Physics',
            'Physics',
            'Physics',
            'Chemistry',
            'Physics',
        ]);
        expect(maxConsecutiveSubjectMinutes(result)).toBeLessThanOrEqual(
            MAX_CONSECUTIVE_SUBJECT_MINUTES,
        );
        expect(violatesInterleaving(result)).toBe(false);
    });

    it('preserves relative order within each subject', () => {
        const units: InterleaveUnit[] = [
            { subjectId: 'A', durationMinutes: 30 },
            { subjectId: 'A', durationMinutes: 45 },
            { subjectId: 'B', durationMinutes: 30 },
            { subjectId: 'A', durationMinutes: 60 },
            { subjectId: 'B', durationMinutes: 90 },
        ];
        const result = interleaveBlocks(units);
        const aDurations = result.filter((u) => u.subjectId === 'A').map((u) => u.durationMinutes);
        const bDurations = result.filter((u) => u.subjectId === 'B').map((u) => u.durationMinutes);
        expect(aDurations).toEqual([30, 45, 60]);
        expect(bDurations).toEqual([30, 90]);
    });
});

describe('interleaveBlocks — track rotation orders (Req 17.2 / 17.3)', () => {
    it('rotates JEE subjects Physics → Mathematics → Chemistry when balanced', () => {
        const units = [
            ...blocks('Physics', 2, 60),
            ...blocks('Mathematics', 2, 60),
            ...blocks('Chemistry', 2, 60),
        ];
        const result = interleaveBlocks(units, {
            subjectPriority: interleaveSubjectsForTrack(ExamTrack.JEE),
        });
        expect(order(result)).toEqual([
            'Physics',
            'Mathematics',
            'Chemistry',
            'Physics',
            'Mathematics',
            'Chemistry',
        ]);
        expect(violatesInterleaving(result)).toBe(false);
    });

    it('rotates NEET subjects Biology → Physics → Chemistry when balanced', () => {
        const units = [
            ...blocks('Biology', 2, 60),
            ...blocks('Physics', 2, 60),
            ...blocks('Chemistry', 2, 60),
        ];
        const result = interleaveBlocks(units, {
            subjectPriority: interleaveSubjectsForTrack(ExamTrack.NEET),
        });
        expect(order(result)).toEqual([
            'Biology',
            'Physics',
            'Chemistry',
            'Biology',
            'Physics',
            'Chemistry',
        ]);
        expect(violatesInterleaving(result)).toBe(false);
    });

    it('uses subjectPriority only as a tie-breaker, scheduling all blocks of every subject', () => {
        const units = [
            ...blocks('Chemistry', 2, 60),
            ...blocks('Physics', 2, 60),
            ...blocks('Mathematics', 2, 60),
        ];
        const result = interleaveBlocks(units, {
            subjectPriority: interleaveSubjectsForTrack(ExamTrack.JEE),
        });
        expect(result).toHaveLength(6);
        expect(distinctSubjectCount(result)).toBe(3);
        // First emitted (all tied on remaining minutes) follows the JEE priority.
        expect(result[0].subjectId).toBe('Physics');
    });
});
