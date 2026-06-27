/**
 * Property-based test for Mistake-Journal flag validity.
 *
 *   - Property 35 (task 14.2): mistake-journal flag validity (Req 18.1, 18.2, 18.3).
 *
 * A single fast-check assertion running the global >= 100 iterations (configured in
 * vitest.setup.ts), placed next to the pure {@link decideFlaggable} +
 * {@link validateMistakeFlagInput} logic it validates. A flag request is accepted iff its
 * category is valid (Req 18.2) AND the referenced question is part of the attempt and is
 * either not correctly-answered or was explicitly flagged (Req 18.3). All other requests
 * are rejected.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { QuestionOutcome } from '@/lib/scoring';

import { decideFlaggable, type PerQuestionRecord } from './flagDecision';
import {
    MISTAKE_CATEGORIES,
    validateMistakeFlagInput,
    type MistakeFlagInput,
} from './mistakeValidation';

/** Category choices: the four valid values, plus invalid/missing sentinels. */
const CATEGORY_CHOICES: Array<unknown> = [...MISTAKE_CATEGORIES, 'BOGUS', undefined, null, ''];

describe('mistake-journal flag validity properties', () => {
    // Feature: jee-neet-study-app, Property 35: For any flag request, it is rejected when no
    // category is selected, and rejected when the referenced question was answered correctly
    // and was not explicitly flagged; otherwise an entry is created storing the question
    // reference, submitted answer, correct answer, category, and optional note.
    it('Property 35: flag accepted iff valid category and (incorrect/unanswered or explicit flag) (Req 18.1, 18.2, 18.3)', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...CATEGORY_CHOICES),
                fc.constantFrom(
                    QuestionOutcome.CORRECT,
                    QuestionOutcome.INCORRECT,
                    QuestionOutcome.UNANSWERED,
                ),
                fc.boolean(), // explicitFlag
                fc.boolean(), // whether the question is part of the attempt
                (category, outcome, explicitFlag, recordPresent) => {
                    const input: MistakeFlagInput = {
                        sourceType: 'PYQ',
                        attemptId: 'attempt-1',
                        questionId: 'q1',
                        category,
                        explicitFlag,
                    };
                    const validation = validateMistakeFlagInput(input);

                    const record: PerQuestionRecord | null = recordPresent
                        ? { questionId: 'q1', outcome }
                        : null;
                    const decision = decideFlaggable(record, explicitFlag);

                    const accepted = validation.ok && decision.allowed;

                    const categoryValid = (MISTAKE_CATEGORIES as readonly unknown[]).includes(
                        category,
                    );

                    // An invalid/missing category is ALWAYS rejected at validation (Req 18.2).
                    if (!categoryValid) {
                        expect(validation.ok).toBe(false);
                        expect(accepted).toBe(false);
                        return;
                    }

                    // With a valid category, acceptance follows the flaggable rule (Req 18.3).
                    expect(validation.ok).toBe(true);

                    if (!recordPresent) {
                        // Question not part of the attempt -> rejected.
                        expect(accepted).toBe(false);
                    } else if (outcome === QuestionOutcome.CORRECT && !explicitFlag) {
                        // Correctly-answered and not explicitly flagged -> rejected.
                        expect(accepted).toBe(false);
                    } else {
                        // Incorrect / unanswered, or explicitly flagged -> accepted.
                        expect(accepted).toBe(true);
                    }
                },
            ),
        );
    });
});
