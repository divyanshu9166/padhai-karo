import { describe, expect, it } from 'vitest';

import {
    NO_RECONCILED_KEY,
    buildPyqRecord,
    deriveIdempotencyKey,
    isFlaggedForReview,
    parseOfficialAnswerKey,
    processExtractionResult,
    reconcileCorrectOption,
    sanitizeText,
    validateExtractedQuestion,
} from './extraction';
import type { ExtractionAssociation, OfficialAnswerKey } from './types';

/**
 * Example/unit tests for the pure PYQ extraction logic (task 12.1, Req 7.1–7.4).
 *
 * These are DB- and Redis-independent: they exercise the pure functions directly. The
 * fast-check Property 34 test (task 12.3) and the worker integration tests (task 12.4) are
 * separate tasks.
 */

const JEE_ASSOCIATION: ExtractionAssociation = {
    examTrack: 'JEE',
    year: 2024,
    subjectId: 'subject-physics',
};

function keyOf(entries: Record<string, number>): OfficialAnswerKey {
    return { entries };
}

describe('sanitizeText', () => {
    it('strips HTML/script markup and collapses whitespace', () => {
        expect(sanitizeText('<script>alert(1)</script>What is  g?')).toBe('alert(1)What is g?');
        expect(sanitizeText('  line1\n\tline2  ')).toBe('line1 line2');
    });

    it('strips an unclosed trailing tag fragment', () => {
        expect(sanitizeText('value <img src=x onerror=')).toBe('value');
    });
});

describe('deriveIdempotencyKey (d) idempotency key derivation', () => {
    it('is deterministic for the same source ref + question ref', () => {
        const a = deriveIdempotencyKey('s3://papers/p1/page-1.png', 'Q1');
        const b = deriveIdempotencyKey('s3://papers/p1/page-1.png', 'Q1');
        expect(a).toBe(b);
    });

    it('ignores surrounding whitespace (normalized) so re-runs match', () => {
        expect(deriveIdempotencyKey('  ref  ', '  Q1 ')).toBe(deriveIdempotencyKey('ref', 'Q1'));
    });

    it('differs across different source refs or question refs', () => {
        const base = deriveIdempotencyKey('ref-a', 'Q1');
        expect(deriveIdempotencyKey('ref-b', 'Q1')).not.toBe(base);
        expect(deriveIdempotencyKey('ref-a', 'Q2')).not.toBe(base);
    });
});

describe('parseOfficialAnswerKey', () => {
    it('coerces numeric and numeric-string indices and skips invalid entries', () => {
        const key = parseOfficialAnswerKey({ Q1: 2, Q2: '3', Q3: 'x', Q4: -1, Q5: 1.5 });
        expect(key.entries).toEqual({ Q1: 2, Q2: 3 });
    });

    it('returns an empty key for non-object input', () => {
        expect(parseOfficialAnswerKey(null).entries).toEqual({});
        expect(parseOfficialAnswerKey([1, 2]).entries).toEqual({});
    });
});

describe('reconcileCorrectOption (a) overwrites correct answer from the key', () => {
    it('returns the key value regardless of the model guess', () => {
        const key = keyOf({ Q1: 3 });
        expect(reconcileCorrectOption('Q1', key)).toBe(3);
    });

    it('returns the no-key sentinel when the question is absent from the key', () => {
        expect(reconcileCorrectOption('Q9', keyOf({ Q1: 0 }))).toBe(NO_RECONCILED_KEY);
    });
});

describe('isFlaggedForReview (b) exactly-four-options gating', () => {
    it('does not flag a record with exactly four options and an in-range key', () => {
        expect(isFlaggedForReview(4, 0)).toBe(false);
        expect(isFlaggedForReview(4, 3)).toBe(false);
    });

    it('flags when the option count is not exactly four', () => {
        expect(isFlaggedForReview(3, 0)).toBe(true);
        expect(isFlaggedForReview(5, 0)).toBe(true);
        expect(isFlaggedForReview(0, 0)).toBe(true);
    });

    it('flags when there is no reconciled key', () => {
        expect(isFlaggedForReview(4, NO_RECONCILED_KEY)).toBe(true);
    });

    it('flags when the reconciled key index is out of range for the options', () => {
        expect(isFlaggedForReview(4, 4)).toBe(true);
    });
});

describe('validateExtractedQuestion', () => {
    it('accepts a well-formed item (wrong option count is valid-but-flagged, not malformed)', () => {
        const result = validateExtractedQuestion({
            questionRef: 'Q1',
            questionText: 'text',
            options: ['a', 'b', 'c'],
        });
        expect(result.ok).toBe(true);
    });

    it('rejects malformed items with a reason', () => {
        expect(validateExtractedQuestion(null).ok).toBe(false);
        expect(validateExtractedQuestion({ questionText: 't', options: [] }).ok).toBe(false);
        expect(
            validateExtractedQuestion({ questionRef: 'Q1', questionText: 5, options: [] }).ok,
        ).toBe(false);
        expect(
            validateExtractedQuestion({ questionRef: 'Q1', questionText: 't', options: [1, 2] }).ok,
        ).toBe(false);
    });
});

describe('buildPyqRecord', () => {
    it('(a)(b)(c) reconciles, gates, sanitizes, and associates track/year/subject', () => {
        const record = buildPyqRecord(
            {
                questionRef: 'Q1',
                questionText: '<b>What is g?</b>',
                options: ['<i>9.8</i>', '8.9', '10', '9.6'],
                modelCorrectOption: 1, // model says option 1 — must be ignored
            },
            JEE_ASSOCIATION,
            keyOf({ Q1: 0 }), // official key says option 0
            's3://papers/p1/page-1.png',
            'paper-1',
        );

        // (a) reconciled from the key, not the model guess
        expect(record.correctOption).toBe(0);
        // (b) exactly four options + in-range key -> eligible
        expect(record.options).toEqual(['9.8', '8.9', '10', '9.6']);
        expect(record.flaggedForReview).toBe(false);
        // (c) association
        expect(record.examTrack).toBe('JEE');
        expect(record.year).toBe(2024);
        expect(record.subjectId).toBe('subject-physics');
        expect(record.paperId).toBe('paper-1');
        // sanitized text
        expect(record.questionText).toBe('What is g?');
        // deterministic id
        expect(record.id).toBe(deriveIdempotencyKey('s3://papers/p1/page-1.png', 'Q1'));
    });

    it('flags a record without exactly four options and excludes it via the flag', () => {
        const record = buildPyqRecord(
            { questionRef: 'Q2', questionText: 'q', options: ['a', 'b', 'c'] },
            JEE_ASSOCIATION,
            keyOf({ Q2: 0 }),
            'ref',
        );
        expect(record.flaggedForReview).toBe(true);
    });

    it('flags a four-option record when the official key has no entry', () => {
        const record = buildPyqRecord(
            { questionRef: 'Q3', questionText: 'q', options: ['a', 'b', 'c', 'd'] },
            JEE_ASSOCIATION,
            keyOf({}),
            'ref',
        );
        expect(record.correctOption).toBe(NO_RECONCILED_KEY);
        expect(record.flaggedForReview).toBe(true);
    });
});

describe('processExtractionResult', () => {
    it('keeps valid items and skips malformed ones without affecting the valid items', () => {
        const outcome = processExtractionResult(
            {
                questions: [
                    {
                        questionRef: 'Q1',
                        questionText: 'valid',
                        options: ['a', 'b', 'c', 'd'],
                    },
                    // malformed: options not an array of strings
                    { questionRef: 'Q2', questionText: 'bad', options: [1, 2] } as never,
                    null as never,
                ],
            },
            JEE_ASSOCIATION,
            keyOf({ Q1: 2 }),
            'ref',
        );

        expect(outcome.records).toHaveLength(1);
        expect(outcome.records[0].questionText).toBe('valid');
        expect(outcome.records[0].correctOption).toBe(2);
        expect(outcome.failures).toHaveLength(2);
    });

    it('tolerates a result with no questions array', () => {
        const outcome = processExtractionResult(
            {} as never,
            JEE_ASSOCIATION,
            keyOf({}),
            'ref',
        );
        expect(outcome.records).toEqual([]);
        expect(outcome.failures).toEqual([]);
    });
});
