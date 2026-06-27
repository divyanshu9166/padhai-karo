import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
    AllocationChapter,
    AttemptQuestionOutcome,
    ChapterStatus,
    QuestionTopicLink,
    pyqChapterFrequency,
} from './frequency';

/**
 * Property-based test for the pure PYQ frequency derivation (task 3.2).
 *
 * Feature: weightage-based-time-allocation, Property 1: PYQ_Chapter_Frequency
 * counts mapped, owned per-question outcomes.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5.
 *
 * The property statement (design.md "Property 1"): for any set of a User's
 * per-question outcomes, any QuestionTopicMap, and any set of the User's
 * Chapters, each Chapter's PYQ_Chapter_Frequency equals the number of that
 * User's per-question outcomes whose questionId resolves — through a
 * QuestionTopicMap entry whose topicKey equals the Chapter's referenceKey — to
 * that Chapter; a question with no map entry contributes to no Chapter (Req 1.2),
 * a question whose topicKey matches multiple Chapter referenceKeys increments
 * each matched Chapter by exactly one (Req 1.3), each outcome is counted at most
 * once per Chapter (Req 1.4), and a User with no attempts yields zero for every
 * Chapter (Req 1.5).
 *
 * Runs the design's minimum of 100 iterations (override the global default with
 * `FC_NUM_RUNS=100`; the assertions below also pin `numRuns` to 100 so the
 * property is validated at full strength regardless of environment).
 */

const STATUSES: readonly ChapterStatus[] = [
    'NOT_STARTED',
    'IN_PROGRESS',
    'DONE',
    'REVISED',
];

// Small, overlapping pools so generated questions, links, and chapters actually
// resolve to one another often enough to exercise the matching logic. Some pool
// members are deliberately "dangling":
//   - 'qUnmapped' appears in outcomes but in no link (exercises Req 1.2),
//   - 'tNoChapter' appears in links but is no Chapter's referenceKey,
//   - 'refUnused' is a Chapter referenceKey that no link targets.
const QUESTION_IDS = ['q1', 'q2', 'q3', 'q4', 'q5', 'qUnmapped'] as const;
const TOPIC_KEYS = ['t1', 't2', 't3', 'tNoChapter'] as const;
const REFERENCE_KEYS = ['t1', 't2', 't3', 'refUnused'] as const;

/** Chapters with unique ids (assigned by index) and possibly shared referenceKeys. */
const chaptersArb: fc.Arbitrary<AllocationChapter[]> = fc
    .array(
        fc.record({
            referenceKey: fc.constantFrom(...REFERENCE_KEYS),
            status: fc.constantFrom(...STATUSES),
            weightage: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), {
                nil: null,
            }),
            weightageIsDefault: fc.boolean(),
        }),
        { maxLength: 8 },
    )
    .map((rows) =>
        rows.map((row, index) => ({ id: `c${index}`, ...row })),
    );

/** QuestionTopicMap links; duplicates of the same (questionId, topicKey) are allowed. */
const linksArb: fc.Arbitrary<QuestionTopicLink[]> = fc.array(
    fc.record({
        questionId: fc.constantFrom(...QUESTION_IDS),
        topicKey: fc.constantFrom(...TOPIC_KEYS),
    }),
    { maxLength: 12 },
);

/** The User's per-question outcomes; questionIds may repeat across outcomes. */
const outcomesArb: fc.Arbitrary<AttemptQuestionOutcome[]> = fc.array(
    fc.record({ questionId: fc.constantFrom(...QUESTION_IDS) }),
    { maxLength: 15 },
);

/**
 * Independent oracle for a single Chapter's expected PYQ_Chapter_Frequency,
 * written directly from the acceptance criteria and structurally different from
 * the implementation (filter/some over arrays rather than pre-built index maps).
 *
 * A Chapter counts an outcome exactly when there EXISTS a link matching the
 * outcome's questionId to that Chapter's referenceKey. Counting outcomes (not
 * links) naturally gives "at most once per Chapter per outcome" (Req 1.4);
 * an outcome counts for every Chapter whose referenceKey a linked topicKey hits
 * (Req 1.3); an outcome with no link counts for none (Req 1.2); zero outcomes
 * yields zero (Req 1.5).
 */
function expectedFrequency(
    chapter: AllocationChapter,
    outcomes: readonly AttemptQuestionOutcome[],
    links: readonly QuestionTopicLink[],
): number {
    return outcomes.filter((outcome) =>
        links.some(
            (link) =>
                link.questionId === outcome.questionId &&
                link.topicKey === chapter.referenceKey,
        ),
    ).length;
}

describe('pyqChapterFrequency — Property 1', () => {
    // Feature: weightage-based-time-allocation, Property 1: PYQ_Chapter_Frequency
    // counts mapped, owned per-question outcomes.
    // Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5.
    it('each Chapter frequency equals the count of mapped owned outcomes resolving to it', () => {
        fc.assert(
            fc.property(outcomesArb, linksArb, chaptersArb, (outcomes, links, chapters) => {
                const result = pyqChapterFrequency(outcomes, links, chapters);

                // The result map contains exactly one entry per supplied Chapter
                // (ids are unique by construction), so no Chapter is dropped and
                // none is invented.
                expect(result.size).toBe(chapters.length);

                for (const chapter of chapters) {
                    const actual = result.get(chapter.id);
                    const expected = expectedFrequency(chapter, outcomes, links);

                    // Req 1.1–1.5: the count matches the independent oracle, which
                    // encodes mapped resolution (1.1), unmapped exclusion (1.2),
                    // multi-match increment-by-one (1.3), at-most-once-per-chapter
                    // (1.4), and the empty-outcomes-zero case (1.5).
                    expect(actual).toBe(expected);

                    // A frequency is always a defined, non-negative integer bounded
                    // by the number of outcomes (each outcome adds at most one).
                    expect(actual).not.toBeUndefined();
                    expect(Number.isInteger(actual)).toBe(true);
                    expect(actual as number).toBeGreaterThanOrEqual(0);
                    expect(actual as number).toBeLessThanOrEqual(outcomes.length);
                }
            }),
            { numRuns: 100 },
        );
    });

    // Req 1.2: appending outcomes whose questionId has no link entry must not
    // change any Chapter's frequency. Req 1.5: with zero outcomes every Chapter
    // reports exactly zero.
    it('unmapped outcomes contribute nothing and an empty attempt set yields zero everywhere', () => {
        fc.assert(
            fc.property(outcomesArb, linksArb, chaptersArb, (outcomes, links, chapters) => {
                // Req 1.5: no attempts => zero for every Chapter.
                const empty = pyqChapterFrequency([], links, chapters);
                expect(empty.size).toBe(chapters.length);
                for (const chapter of chapters) {
                    expect(empty.get(chapter.id)).toBe(0);
                }

                // Req 1.2: 'qUnmapped' has no link, so adding any number of such
                // outcomes leaves every Chapter's frequency identical.
                const baseline = pyqChapterFrequency(outcomes, links, chapters);
                const linkedQuestionIds = new Set(links.map((link) => link.questionId));
                fc.pre(!linkedQuestionIds.has('qUnmapped'));
                const withUnmapped = pyqChapterFrequency(
                    [
                        ...outcomes,
                        { questionId: 'qUnmapped' },
                        { questionId: 'qUnmapped' },
                    ],
                    links,
                    chapters,
                );
                for (const chapter of chapters) {
                    expect(withUnmapped.get(chapter.id)).toBe(baseline.get(chapter.id));
                }
            }),
            { numRuns: 100 },
        );
    });

    // Req 1.3 & 1.4: one outcome whose question links to a single topicKey shared
    // by several Chapters increments each of those Chapters by exactly one — even
    // when the (questionId, topicKey) link is duplicated — and increments no other
    // Chapter.
    it('a single outcome increments each matched Chapter by exactly one despite duplicate links', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(fc.constantFrom(...REFERENCE_KEYS), {
                    minLength: 1,
                    maxLength: REFERENCE_KEYS.length,
                }),
                fc.integer({ min: 1, max: 3 }),
                (sharedKeys, duplicateLinkCount) => {
                    const targetKey = sharedKeys[0];
                    // Two Chapters share the target referenceKey (multi-match), one
                    // Chapter carries a different key (must stay at zero).
                    const otherKey =
                        REFERENCE_KEYS.find((key) => key !== targetKey) ?? 'refUnused';
                    const chapters: AllocationChapter[] = [
                        {
                            id: 'cA',
                            referenceKey: targetKey,
                            status: 'NOT_STARTED',
                            weightage: 1,
                            weightageIsDefault: false,
                        },
                        {
                            id: 'cB',
                            referenceKey: targetKey,
                            status: 'IN_PROGRESS',
                            weightage: 1,
                            weightageIsDefault: false,
                        },
                        {
                            id: 'cC',
                            referenceKey: otherKey,
                            status: 'DONE',
                            weightage: 1,
                            weightageIsDefault: false,
                        },
                    ];
                    // Duplicate the same link to exercise the at-most-once rule (Req 1.4).
                    const links: QuestionTopicLink[] = Array.from(
                        { length: duplicateLinkCount },
                        () => ({ questionId: 'q1', topicKey: targetKey }),
                    );
                    const result = pyqChapterFrequency([{ questionId: 'q1' }], links, chapters);

                    // Req 1.3 + 1.4: each matched Chapter incremented by exactly one.
                    expect(result.get('cA')).toBe(1);
                    expect(result.get('cB')).toBe(1);
                    // Unmatched Chapter is untouched (and stays zero when keys differ).
                    expect(result.get('cC')).toBe(otherKey === targetKey ? 1 : 0);
                },
            ),
            { numRuns: 100 },
        );
    });
});
