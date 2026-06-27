/**
 * Property-based test for the input-immutability guarantee of the pure
 * analytics computations.
 *
 *   - Property 12 (task 13.1): analytics computation does not mutate Phase 1
 *     inputs (Req 9.5, 11.5, 13.2).
 *
 * The Analytics_Service treats persisted Phase 1 rows as an immutable input: it
 * reads attempt outcomes, mistake-journal entries, and focus-session rows and
 * derives outputs without ever altering those records. The pure modules under
 * test (`computeAttemptQuality` and `computeWeakAreas`) receive already-read
 * rows and must leave every input deep-equal to its pre-computation value — no
 * field altered, no array reordered.
 *
 * A single fast-check assertion running a minimum of 100 iterations, mirroring
 * the fast-check + vitest convention of the other `*.property.test.ts` modules
 * in this codebase. The inputs are deep-cloned BEFORE the calls and compared
 * with `toEqual` AFTER; the inputs are also `Object.freeze`d (deeply) to catch
 * any in-place write at the moment it happens.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { QuestionOutcome } from '../../lib/scoring/score';
import {
    computeAttemptQuality,
    type AttemptQuestionOutcome,
} from './attemptQuality';
import {
    computeWeakAreas,
    MISTAKE_CATEGORIES,
    SESSION_TYPES,
    type MistakeCategory,
    type SessionType,
    type WeakAreaDerivationInput,
    type WeakAreaFocusSessionRow,
    type WeakAreaMistakeRow,
    type WeakAreaOutcomeRow,
} from './weakArea';

const OUTCOME_POOL: readonly QuestionOutcome[] = [
    QuestionOutcome.CORRECT,
    QuestionOutcome.INCORRECT,
    QuestionOutcome.UNANSWERED,
];

/** An arbitrary per-question outcome entry for {@link computeAttemptQuality}. */
const attemptOutcomeArb: fc.Arbitrary<AttemptQuestionOutcome> = fc.record({
    questionId: fc.uuid(),
    outcome: fc.constantFrom(...OUTCOME_POOL),
});

const perQuestionArb: fc.Arbitrary<AttemptQuestionOutcome[]> = fc.array(attemptOutcomeArb, {
    maxLength: 50,
});

/** Optional total time taken (seconds), or `null`/`undefined` (no time). */
const timeTakenArb: fc.Arbitrary<number | null | undefined> = fc.oneof(
    fc.double({ min: 0, max: 100_000, noNaN: true }),
    fc.constant(null),
    fc.constant(undefined),
);

/** A small pool of subject ids / topic keys so buckets actually overlap. */
const subjectIdArb: fc.Arbitrary<string> = fc.constantFrom('SUB_A', 'SUB_B', 'SUB_C');
const topicKeyArb: fc.Arbitrary<string | null> = fc.oneof(
    fc.constantFrom('TOP_1', 'TOP_2', 'TOP_3'),
    fc.constant(null),
);
const mistakeCategoryArb: fc.Arbitrary<MistakeCategory> = fc.constantFrom(...MISTAKE_CATEGORIES);
const sessionTypeArb: fc.Arbitrary<SessionType> = fc.constantFrom(...SESSION_TYPES);

/** An already-joined per-question outcome row for weak-area derivation. */
const weakAreaOutcomeArb: fc.Arbitrary<WeakAreaOutcomeRow> = fc.record({
    subjectId: subjectIdArb,
    subjectName: fc.option(fc.string(), { nil: null }),
    topicKey: topicKeyArb,
    topicName: fc.option(fc.string(), { nil: null }),
    outcome: fc.constantFrom(...OUTCOME_POOL),
});

/** An already-joined mistake-journal row for weak-area derivation. */
const weakAreaMistakeArb: fc.Arbitrary<WeakAreaMistakeRow> = fc.record({
    subjectId: subjectIdArb,
    subjectName: fc.option(fc.string(), { nil: null }),
    topicKey: topicKeyArb,
    topicName: fc.option(fc.string(), { nil: null }),
    category: mistakeCategoryArb,
});

/** An already-read focus-session row for the session-type distribution. */
const weakAreaFocusSessionArb: fc.Arbitrary<WeakAreaFocusSessionRow> = fc.record({
    sessionType: sessionTypeArb,
    focusedDurationMin: fc.double({ min: 0, max: 600, noNaN: true }),
});

const weakAreaInputArb: fc.Arbitrary<WeakAreaDerivationInput> = fc.record({
    outcomes: fc.array(weakAreaOutcomeArb, { maxLength: 40 }),
    mistakes: fc.array(weakAreaMistakeArb, { maxLength: 40 }),
    focusSessions: fc.array(weakAreaFocusSessionArb, { maxLength: 40 }),
});

/** Recursively freeze a value so any in-place write throws in strict mode. */
function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const key of Object.keys(value as Record<string, unknown>)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
    }
    return value;
}

describe('analytics no-mutation properties', () => {
    // Feature: performance-analytics, Property 12: For any input attempt outcome rows, mistake
    // rows, and focus-session rows, computing attempt quality and weak areas leaves every input
    // deep-equal to its pre-computation value (no field altered, no array reordered).
    it('Property 12: analytics computation does not mutate Phase 1 inputs (Req 9.5, 11.5, 13.2)', () => {
        fc.assert(
            fc.property(
                perQuestionArb,
                timeTakenArb,
                weakAreaInputArb,
                (perQuestion, timeTakenSec, weakAreaInput) => {
                    // Snapshot the pre-computation values via a deep clone.
                    const perQuestionClone = structuredClone(perQuestion);
                    const weakAreaInputClone = structuredClone(weakAreaInput);

                    // Freeze the actual inputs so any in-place write throws immediately.
                    deepFreeze(perQuestion);
                    deepFreeze(weakAreaInput);

                    // Invoke both pure computations on the (frozen) inputs.
                    computeAttemptQuality(perQuestion, timeTakenSec);
                    computeWeakAreas(weakAreaInput);

                    // Every input remains deep-equal to its pre-computation value: no field
                    // altered, no array reordered (Req 9.5, 11.5, 13.2).
                    expect(perQuestion).toEqual(perQuestionClone);
                    expect(weakAreaInput).toEqual(weakAreaInputClone);
                },
            ),
            { numRuns: 100 },
        );
    });
});
