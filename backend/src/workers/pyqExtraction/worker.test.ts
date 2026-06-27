import { describe, expect, it } from 'vitest';

import { deriveIdempotencyKey } from './extraction';
import { processPyqExtractionJob, type PyqExtractionDb } from './worker';
import type {
    PyqExtractionJobData,
    VisionExtractionResult,
    VisionExtractor,
} from './types';

/**
 * Example/unit tests for the `pyq-extraction` job processor (task 12.1, Req 7.1–7.4).
 *
 * The AI vision call is mocked and the Prisma client is replaced with an in-memory fake
 * keyed by record id, so these tests run without Redis or a database. They cover the
 * end-to-end orchestration: reconciliation (7.2), option-count gating (7.3),
 * track/year/subject association (7.4), and re-run idempotency. The full worker integration
 * test against a live queue/DB is task 12.4.
 */

/** A mock extractor returning a fixed, scripted result for any source image ref. */
function mockExtractor(result: VisionExtractionResult): VisionExtractor {
    return {
        async extractQuestionsFromImage() {
            return result;
        },
    };
}

/** An in-memory fake of the slice of Prisma the processor uses. */
function fakeDb(answerKeyEntries: Record<string, number>): {
    db: PyqExtractionDb;
    store: Map<string, Record<string, unknown>>;
} {
    const store = new Map<string, Record<string, unknown>>();

    const db: PyqExtractionDb = {
        answerKey: {
            async findUnique() {
                return { entries: answerKeyEntries };
            },
        },
        pYQ: {
            async upsert(args) {
                const existing = store.get(args.where.id);
                if (existing) {
                    store.set(args.where.id, { ...existing, ...args.update });
                } else {
                    store.set(args.where.id, { ...args.create });
                }
                return store.get(args.where.id);
            },
        },
    };

    return { db, store };
}

const JOB: PyqExtractionJobData = {
    sourceImageRefs: ['s3://papers/p1/page-1.png'],
    examTrack: 'NEET',
    year: 2023,
    subjectId: 'subject-biology',
    answerKeyId: 'answer-key-1',
    paperId: 'paper-1',
};

const RESULT: VisionExtractionResult = {
    questions: [
        {
            questionRef: 'Q1',
            questionText: 'Eligible question',
            options: ['a', 'b', 'c', 'd'],
            modelCorrectOption: 3, // wrong on purpose; must be overwritten by the key
        },
        {
            questionRef: 'Q2',
            questionText: 'Only three options',
            options: ['a', 'b', 'c'],
        },
    ],
};

describe('processPyqExtractionJob', () => {
    it('reconciles the key, gates by option count, and associates track/year/subject', async () => {
        const harness = fakeDb({ Q1: 1, Q2: 0 });
        const result = await processPyqExtractionJob(
            JOB,
            { extractor: mockExtractor(RESULT), db: harness.db },
        );

        expect(result.produced).toBe(2);
        expect(result.flaggedForReview).toBe(1);

        const q1 = harness.store.get(deriveIdempotencyKey(JOB.sourceImageRefs[0], 'Q1'));
        const q2 = harness.store.get(deriveIdempotencyKey(JOB.sourceImageRefs[0], 'Q2'));

        // Reconciliation (7.2): key value 1 overrides the model's guess of 3.
        expect(q1?.correctOption).toBe(1);
        expect(q1?.flaggedForReview).toBe(false);
        // Association (7.4).
        expect(q1?.examTrack).toBe('NEET');
        expect(q1?.year).toBe(2023);
        expect(q1?.subjectId).toBe('subject-biology');
        expect(q1?.paperId).toBe('paper-1');

        // Gating (7.3): three options -> flagged for review.
        expect(q2?.flaggedForReview).toBe(true);
    });

    it('is idempotent: re-running the same source ref does not duplicate records', async () => {
        const harness = fakeDb({ Q1: 1, Q2: 0 });

        await processPyqExtractionJob(JOB, { extractor: mockExtractor(RESULT), db: harness.db });
        const sizeAfterFirst = harness.store.size;

        await processPyqExtractionJob(JOB, { extractor: mockExtractor(RESULT), db: harness.db });
        const sizeAfterSecond = harness.store.size;

        expect(sizeAfterFirst).toBe(2);
        expect(sizeAfterSecond).toBe(2); // upserts updated in place, no duplicates
    });

    it('skips malformed items but still produces the valid ones', async () => {
        const harness = fakeDb({ Q1: 0 });
        const result = await processPyqExtractionJob(
            {
                ...JOB,
                sourceImageRefs: ['ref-x'],
            },
            {
                extractor: mockExtractor({
                    questions: [
                        { questionRef: 'Q1', questionText: 'ok', options: ['a', 'b', 'c', 'd'] },
                        { questionText: 'no ref', options: [] } as never,
                    ],
                }),
                db: harness.db,
            },
        );

        expect(result.produced).toBe(1);
        expect(result.failures).toHaveLength(1);
        expect(harness.store.size).toBe(1);
    });
});
