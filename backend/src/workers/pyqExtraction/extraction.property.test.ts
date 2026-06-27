/**
 * Property-based test for the pure PYQ extraction reconciliation + option-count gating.
 *
 *   - Property 34 (task 12.3): extraction reconciliation and option-count gating
 *     (Req 7.2, 7.3, 7.4).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the {@link buildPyqRecord} / {@link reconcileCorrectOption}
 * / {@link isFlaggedForReview} logic it validates. For any extracted question, the stored
 * correct answer equals the official key value (never the model's guess), any record
 * without exactly four valid options is flagged for review and excluded, and every record
 * carries its associated exam track, year, and subject.
 */
import type { ExamTrack } from '@prisma/client';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    buildPyqRecord,
    NO_RECONCILED_KEY,
    REQUIRED_OPTION_COUNT,
} from './extraction';
import type { ExtractionAssociation, OfficialAnswerKey, RawExtractedQuestion } from './types';

describe('extraction reconciliation + gating properties', () => {
    // Feature: jee-neet-study-app, Property 34: For any extracted PYQ record, the stored
    // correct answer equals the official answer-key value, and any record without exactly
    // four options is flagged for manual review and excluded from practice availability;
    // every stored PYQ carries an exam track, year, and subject.
    it('Property 34: reconciles from the key, gates on option count, associates track/year/subject (Req 7.2, 7.3, 7.4)', () => {
        fc.assert(
            fc.property(
                fc.record({
                    examTrack: fc.constantFrom<ExamTrack>('JEE', 'NEET'),
                    year: fc.integer({ min: 1900, max: 3000 }),
                    subjectId: fc.string({ minLength: 1 }),
                }),
                // questionRef must survive trimming to a non-empty key.
                fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
                fc.string(),
                // 0..6 options so both "exactly four" and "not four" cases occur.
                fc.array(fc.string(), { maxLength: 6 }),
                // The model's guess: untrusted, must be IGNORED.
                fc.integer({ min: -5, max: 10 }),
                // Whether the official key has an entry for this question, and its value.
                fc.boolean(),
                fc.integer({ min: -2, max: 6 }),
                (
                    associationInput,
                    questionRef,
                    questionText,
                    options,
                    modelCorrectOption,
                    keyPresent,
                    keyValue,
                ) => {
                    const association: ExtractionAssociation = associationInput;
                    const raw: RawExtractedQuestion = {
                        questionRef,
                        questionText,
                        options,
                        modelCorrectOption,
                    };

                    // parseOfficialAnswerKey only keeps non-negative integer indices, so a
                    // negative keyValue is dropped (no entry). Mirror that here.
                    const entries: Record<string, number> = {};
                    if (keyPresent && keyValue >= 0) {
                        entries[questionRef] = keyValue;
                    }
                    const officialKey: OfficialAnswerKey = { entries };

                    const record = buildPyqRecord(
                        raw,
                        association,
                        officialKey,
                        's3://source/page.png',
                    );

                    // (Req 7.4) Association is always carried through.
                    expect(record.examTrack).toBe(association.examTrack);
                    expect(record.year).toBe(association.year);
                    expect(record.subjectId).toBe(association.subjectId);

                    // (Req 7.2) The stored correct answer equals the official key value (or
                    // the sentinel when no key entry exists), NEVER the model's guess.
                    const expectedReconciled =
                        entries[questionRef] === undefined
                            ? NO_RECONCILED_KEY
                            : entries[questionRef];
                    expect(record.correctOption).toBe(expectedReconciled);

                    // (Req 7.3) Eligibility: only exactly-four options AND an in-range
                    // reconciled key make a record practice-eligible (not flagged).
                    const hasFour = options.length === REQUIRED_OPTION_COUNT;
                    const hasKey = expectedReconciled !== NO_RECONCILED_KEY;
                    const inRange =
                        expectedReconciled >= 0 && expectedReconciled < options.length;
                    const expectedFlag = !(hasFour && hasKey && inRange);
                    expect(record.flaggedForReview).toBe(expectedFlag);

                    // (Req 7.3) Specifically: not exactly four options => always flagged.
                    if (options.length !== REQUIRED_OPTION_COUNT) {
                        expect(record.flaggedForReview).toBe(true);
                    }
                },
            ),
        );
    });
});
