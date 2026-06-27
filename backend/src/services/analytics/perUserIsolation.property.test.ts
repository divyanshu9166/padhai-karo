/**
 * Property-based test for per-user isolation of analytics outputs (task 24.1).
 *
 *   - Property 17 (task 24.1): per-user isolation of analytics outputs (Req 14.2).
 *
 * Req 14.2 requires that "WHEN an authenticated User requests any Performance Analytics
 * output, THE Analytics_Service SHALL compute the output using only data owned by the
 * requesting User." We assert this structurally on a representative handler that aggregates
 * many user-owned rows: the Weak-Area service `getWeakAreaResult(userId)`, which reads the
 * user's `PYQAttempt`/`TimedPaperAttempt` outcomes, `MistakeJournalEntry`, `FocusSession`,
 * and `Chapter` rows (all `userId`-scoped) plus the global `PYQ`/`QuestionTopicMap`/`Subject`
 * reference rows.
 *
 * The property: for any two disjoint users' datasets, the analytics output computed for
 * userA is identical whether or not userB's rows are present in the store. We drive the
 * handler with a mocked Prisma client (vi.hoisted + vi.mock('@/lib/db')) backed by an
 * in-memory store partitioned by `userId`; each `findMany` honors its `where` clause
 * (`userId` for user-owned models, `id`/`questionId`/`referenceKey` `in`-filters for the
 * reference models). We compute the result with ONLY userA's rows present, then again with
 * BOTH users' rows present, and assert the two results are deep-equal — proving the output
 * depends only on the requesting user's data.
 *
 * A single fast-check assertion running >= 100 iterations.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Prisma mock: an in-memory store partitioned by userId ------------------
//
// The store arrays are populated per run via `setStore`. Each mocked `findMany`
// honors the `where` clause the real handler passes: user-owned models filter by
// `where.userId`; the global reference models filter by their `in`-list; `chapter`
// filters by BOTH `userId` and `referenceKey.in`.
const { store, mocks } = vi.hoisted(() => {
    interface Where {
        userId?: string;
        id?: { in: string[] };
        questionId?: { in: string[] };
        referenceKey?: { in: string[] };
    }
    const store = {
        pyqAttempts: [] as Array<{ userId: string; perQuestion: unknown }>,
        timedAttempts: [] as Array<{ userId: string; perQuestion: unknown }>,
        mistakes: [] as Array<{
            userId: string;
            questionId: string;
            subjectId: string;
            category: string;
        }>,
        focusSessions: [] as Array<{
            userId: string;
            sessionType: string;
            focusedDurationMin: number;
        }>,
        questions: [] as Array<{ id: string; subjectId: string }>,
        topicMaps: [] as Array<{ questionId: string; topicKey: string }>,
        subjects: [] as Array<{ id: string; name: string }>,
        chapters: [] as Array<{ userId: string; referenceKey: string; name: string }>,
    };

    const byUser = <T extends { userId: string }>(rows: T[], where: Where): T[] =>
        rows.filter((row) => row.userId === where.userId);

    const byIn = <T>(rows: T[], field: keyof T, list: string[] | undefined): T[] => {
        const set = new Set(list ?? []);
        return rows.filter((row) => set.has(row[field] as unknown as string));
    };

    const mocks = {
        findManyPyqAttempt: vi.fn(({ where }: { where: Where }) =>
            Promise.resolve(byUser(store.pyqAttempts, where)),
        ),
        findManyTimedAttempt: vi.fn(({ where }: { where: Where }) =>
            Promise.resolve(byUser(store.timedAttempts, where)),
        ),
        findManyMistake: vi.fn(({ where }: { where: Where }) =>
            Promise.resolve(byUser(store.mistakes, where)),
        ),
        findManyFocusSession: vi.fn(({ where }: { where: Where }) =>
            Promise.resolve(byUser(store.focusSessions, where)),
        ),
        findManyPyq: vi.fn(({ where }: { where: Where }) =>
            Promise.resolve(byIn(store.questions, 'id', where.id?.in)),
        ),
        findManyTopicMap: vi.fn(({ where }: { where: Where }) =>
            Promise.resolve(byIn(store.topicMaps, 'questionId', where.questionId?.in)),
        ),
        findManySubject: vi.fn(({ where }: { where: Where }) =>
            Promise.resolve(byIn(store.subjects, 'id', where.id?.in)),
        ),
        findManyChapter: vi.fn(({ where }: { where: Where }) =>
            Promise.resolve(
                byIn(
                    byUser(store.chapters, where),
                    'referenceKey',
                    where.referenceKey?.in,
                ),
            ),
        ),
    };

    return { store, mocks };
});

vi.mock('@/lib/db', () => {
    const prisma = {
        pYQAttempt: { findMany: mocks.findManyPyqAttempt },
        timedPaperAttempt: { findMany: mocks.findManyTimedAttempt },
        mistakeJournalEntry: { findMany: mocks.findManyMistake },
        focusSession: { findMany: mocks.findManyFocusSession },
        pYQ: { findMany: mocks.findManyPyq },
        questionTopicMap: { findMany: mocks.findManyTopicMap },
        subject: { findMany: mocks.findManySubject },
        chapter: { findMany: mocks.findManyChapter },
    };
    return { default: prisma, prisma };
});

import { getWeakAreaResult } from './weakAreaService';

// --- Generated dataset shape ------------------------------------------------

const OUTCOMES = ['CORRECT', 'INCORRECT', 'UNANSWERED'] as const;
const CATEGORIES = ['SILLY_MISTAKE', 'CONCEPT_GAP', 'TIME_PRESSURE', 'NEVER_SEEN_THIS'] as const;
const SESSION_TYPES = [
    'NEW_CHAPTER',
    'PRACTICE_PROBLEMS',
    'REVISION',
    'MOCK_ANALYSIS',
    'FORMULA_DRILL',
] as const;

interface Dataset {
    userId: string;
    // global reference rows (PYQ / QuestionTopicMap / Subject)
    questions: Array<{ id: string; subjectId: string }>;
    topicMaps: Array<{ questionId: string; topicKey: string }>;
    subjects: Array<{ id: string; name: string }>;
    // user-owned rows
    chapters: Array<{ userId: string; referenceKey: string; name: string }>;
    pyqAttempts: Array<{ userId: string; perQuestion: Array<{ questionId: string; outcome: string }> }>;
    timedAttempts: Array<{ userId: string; perQuestion: Array<{ questionId: string; outcome: string }> }>;
    mistakes: Array<{ userId: string; questionId: string; subjectId: string; category: string }>;
    focusSessions: Array<{ userId: string; sessionType: string; focusedDurationMin: number }>;
}

/**
 * An arbitrary dataset fully namespaced by `tag` so two datasets built with distinct tags
 * are disjoint across every key (subject ids, question ids, topic keys, userId). This makes
 * the isolation assertion unambiguous: userB's rows can never coincide with userA's.
 */
function datasetArb(tag: string): fc.Arbitrary<Dataset> {
    return fc
        .record({
            numSubjects: fc.integer({ min: 1, max: 3 }),
            numTopics: fc.integer({ min: 0, max: 3 }),
        })
        .chain(({ numSubjects, numTopics }) => {
            const subjects = Array.from({ length: numSubjects }, (_unused, i) => ({
                id: `${tag}-subj-${i}`,
                name: `${tag} Subject ${i}`,
            }));
            const topicKeys = Array.from({ length: numTopics }, (_unused, i) => `${tag}-topic-${i}`);
            const chapters = topicKeys.map((referenceKey, i) => ({
                userId: tag,
                referenceKey,
                name: `${tag} Chapter ${i}`,
            }));

            const questionSpecArb = fc.record({
                subjectI: fc.integer({ min: 0, max: numSubjects - 1 }),
                // When numTopics === 0 the range is [-1, -1] => always -1 => no topic.
                topicI: fc.integer({ min: -1, max: numTopics - 1 }),
            });

            return fc
                .array(questionSpecArb, { minLength: 1, maxLength: 6 })
                .chain((questionSpecs) => {
                    const questionMeta = questionSpecs.map((spec, i) => ({
                        id: `${tag}-q-${i}`,
                        subjectId: subjects[spec.subjectI].id,
                        topicKey: spec.topicI >= 0 ? topicKeys[spec.topicI] : null,
                    }));
                    const numQ = questionMeta.length;
                    const qIndexArb = fc.integer({ min: 0, max: numQ - 1 });

                    const perQuestionArb = fc.array(
                        fc.record({ qI: qIndexArb, outcome: fc.constantFrom(...OUTCOMES) }),
                        { minLength: 0, maxLength: 5 },
                    );
                    const attemptsArb = fc.array(perQuestionArb, { minLength: 0, maxLength: 3 });

                    return fc
                        .record({
                            pyq: attemptsArb,
                            timed: attemptsArb,
                            mistakeSpecs: fc.array(
                                fc.record({ qI: qIndexArb, category: fc.constantFrom(...CATEGORIES) }),
                                { minLength: 0, maxLength: 4 },
                            ),
                            focusSpecs: fc.array(
                                fc.record({
                                    sessionType: fc.constantFrom(...SESSION_TYPES),
                                    focusedDurationMin: fc.integer({ min: 1, max: 120 }),
                                }),
                                { minLength: 0, maxLength: 4 },
                            ),
                        })
                        .map(({ pyq, timed, mistakeSpecs, focusSpecs }) => {
                            const toPerQuestion = (
                                entries: Array<{ qI: number; outcome: string }>,
                            ) => ({
                                userId: tag,
                                perQuestion: entries.map((e) => ({
                                    questionId: questionMeta[e.qI].id,
                                    outcome: e.outcome,
                                })),
                            });

                            const dataset: Dataset = {
                                userId: tag,
                                questions: questionMeta.map((q) => ({
                                    id: q.id,
                                    subjectId: q.subjectId,
                                })),
                                topicMaps: questionMeta
                                    .filter((q) => q.topicKey !== null)
                                    .map((q) => ({ questionId: q.id, topicKey: q.topicKey as string })),
                                subjects,
                                chapters,
                                pyqAttempts: pyq.map(toPerQuestion),
                                timedAttempts: timed.map(toPerQuestion),
                                mistakes: mistakeSpecs.map((m) => ({
                                    userId: tag,
                                    questionId: questionMeta[m.qI].id,
                                    subjectId: questionMeta[m.qI].subjectId,
                                    category: m.category,
                                })),
                                focusSessions: focusSpecs.map((f) => ({
                                    userId: tag,
                                    sessionType: f.sessionType,
                                    focusedDurationMin: f.focusedDurationMin,
                                })),
                            };
                            return dataset;
                        });
                });
        });
}

/** Clear the in-memory store and load the given datasets' rows into it. */
function setStore(datasets: Dataset[]): void {
    store.pyqAttempts.length = 0;
    store.timedAttempts.length = 0;
    store.mistakes.length = 0;
    store.focusSessions.length = 0;
    store.questions.length = 0;
    store.topicMaps.length = 0;
    store.subjects.length = 0;
    store.chapters.length = 0;

    for (const ds of datasets) {
        store.pyqAttempts.push(...ds.pyqAttempts);
        store.timedAttempts.push(...ds.timedAttempts);
        store.mistakes.push(...ds.mistakes);
        store.focusSessions.push(...ds.focusSessions);
        store.questions.push(...ds.questions);
        store.topicMaps.push(...ds.topicMaps);
        store.subjects.push(...ds.subjects);
        store.chapters.push(...ds.chapters);
    }
}

beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockClear());
});

describe('per-user isolation of analytics outputs', () => {
    // Feature: performance-analytics, Property 17: For any two users' datasets, the analytics
    // output computed for one user is identical whether or not the other user's rows are
    // present; i.e. the output depends only on the requesting user's data (Req 14.2).
    it('Property 17: weak-area output for userA is unaffected by userB rows in the store (Req 14.2)', async () => {
        await fc.assert(
            fc.asyncProperty(datasetArb('userA'), datasetArb('userB'), async (userA, userB) => {
                // 1) Compute userA's analytics with ONLY userA's rows present.
                setStore([userA]);
                const resultAlone = await getWeakAreaResult('userA');

                // 2) Compute userA's analytics again with BOTH users' rows present.
                setStore([userA, userB]);
                const resultWithOther = await getWeakAreaResult('userA');

                // The output depends only on the requesting user's data: identical results.
                expect(resultWithOther).toEqual(resultAlone);
            }),
            { numRuns: 100 },
        );
    });
});
