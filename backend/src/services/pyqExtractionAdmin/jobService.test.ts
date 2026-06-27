import { describe, expect, it, vi } from 'vitest';

import type { AuthContext } from '@/lib/auth';
import type { PyqExtractionJobData } from '@/workers/pyqExtraction/types';

import {
    createPyqExtractionJobHandler,
    getPyqExtractionJobHandler,
    type AdminQueueJob,
    type PyqExtractionJobQueue,
} from './jobService';

/**
 * Example/unit tests for the operator PYQ-extraction job handlers (task 12.2, Req 7.1/7.3).
 *
 * The queue is injected as a mock implementing the minimal {@link PyqExtractionJobQueue}
 * surface, so these tests run without a live Redis/BullMQ connection: `add` returns a job
 * id (-> 202), `getJob` returns a job state/return value (-> 200), and a missing job (-> 404).
 */

const BASE = 'http://localhost/api/admin/pyq-extraction/jobs';

function authCtx(userId = 'operator-1'): AuthContext {
    // Only the session-guard wrapper inspects auth; the handlers do not read user.id today.
    return { user: { id: userId } as AuthContext['user'], session: {} as AuthContext['session'] };
}

const VALID_BODY = {
    sourceImageRefs: ['s3://papers/p1/page-1.png'],
    track: 'NEET',
    year: 2023,
    subjectId: 'subject-biology',
    answerKeyId: 'answer-key-1',
    paperId: 'paper-1',
};

function postRequest(body: unknown): Request {
    return new Request(BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('createPyqExtractionJobHandler', () => {
    it('enqueues a pyq-extraction job and returns 202 { jobId }', async () => {
        const add = vi
            .fn<(name: string, data: PyqExtractionJobData) => Promise<{ id?: string | null }>>()
            .mockResolvedValue({ id: 'job-42' });
        const queue: PyqExtractionJobQueue = {
            add,
            getJob: vi.fn(),
        };

        const response = await createPyqExtractionJobHandler(
            postRequest(VALID_BODY),
            authCtx(),
            () => queue,
        );

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ jobId: 'job-42' });

        // The assembled payload renames track -> examTrack and is enqueued on the right queue.
        expect(add).toHaveBeenCalledTimes(1);
        const [queueName, jobData] = add.mock.calls[0];
        expect(queueName).toBe('pyq-extraction');
        expect(jobData).toEqual({
            sourceImageRefs: ['s3://papers/p1/page-1.png'],
            examTrack: 'NEET',
            year: 2023,
            subjectId: 'subject-biology',
            answerKeyId: 'answer-key-1',
            paperId: 'paper-1',
        });
    });

    it('returns 422 for an invalid body and does not enqueue', async () => {
        const add = vi.fn();
        const queue: PyqExtractionJobQueue = { add, getJob: vi.fn() };

        const response = await createPyqExtractionJobHandler(
            postRequest({ ...VALID_BODY, sourceImageRefs: [] }),
            authCtx(),
            () => queue,
        );

        expect(response.status).toBe(422);
        const body = await response.json();
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(add).not.toHaveBeenCalled();
    });

    it('returns 422 when the body is not a JSON object', async () => {
        const queue: PyqExtractionJobQueue = { add: vi.fn(), getJob: vi.fn() };
        const request = new Request(BASE, { method: 'POST', body: 'not json' });

        const response = await createPyqExtractionJobHandler(request, authCtx(), () => queue);

        expect(response.status).toBe(422);
    });
});

describe('getPyqExtractionJobHandler', () => {
    function queueWithJob(job: AdminQueueJob | null | undefined): PyqExtractionJobQueue {
        return { add: vi.fn(), getJob: vi.fn().mockResolvedValue(job) };
    }

    it('returns 200 { status, produced, flaggedForReview } from a completed job', async () => {
        const job: AdminQueueJob = {
            getState: vi.fn().mockResolvedValue('completed'),
            returnvalue: { produced: 5, flaggedForReview: 2, failures: [] },
        };

        const response = await getPyqExtractionJobHandler(
            new Request(`${BASE}/job-42`),
            authCtx(),
            { params: { id: 'job-42' } },
            () => queueWithJob(job),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            status: 'completed',
            produced: 5,
            flaggedForReview: 2,
        });
    });

    it('defaults produced/flaggedForReview to 0 when the job has no return value yet', async () => {
        const job: AdminQueueJob = {
            getState: vi.fn().mockResolvedValue('active'),
            returnvalue: null,
        };

        const response = await getPyqExtractionJobHandler(
            new Request(`${BASE}/job-7`),
            authCtx(),
            { params: { id: 'job-7' } },
            () => queueWithJob(job),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            status: 'active',
            produced: 0,
            flaggedForReview: 0,
        });
    });

    it('returns 404 when no job exists for the id', async () => {
        const response = await getPyqExtractionJobHandler(
            new Request(`${BASE}/missing`),
            authCtx(),
            { params: { id: 'missing' } },
            () => queueWithJob(undefined),
        );

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error.code).toBe('NOT_FOUND');
    });
});
