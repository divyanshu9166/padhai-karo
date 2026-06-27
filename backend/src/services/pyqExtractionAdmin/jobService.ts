/**
 * Operator PYQ-extraction job endpoints (task 12.2; design "PYQ Extraction Pipeline
 * (Worker, Req 7)"; Req 7.1, 7.3).
 *
 *   POST /api/admin/pyq-extraction/jobs   (operator)
 *     body: { sourceImageRefs[], track, year, subjectId, answerKeyId, paperId? }
 *     -> 202 { jobId }                                                  (Req 7.1)
 *     -> 422 VALIDATION_ERROR (bad body)
 *
 *   GET /api/admin/pyq-extraction/jobs/:id (operator)
 *     -> 200 { status, produced, flaggedForReview }                    (Req 7.1/7.3)
 *     -> 404 NOT_FOUND (no such job)
 *
 * Authorization posture: these are operator/admin endpoints. The schema has no dedicated
 * admin-role concept (see design "Data Models"), so for now they are guarded by the same
 * `withAuth` session guard as every other protected endpoint — the route files wrap these
 * handlers with it, rejecting unauthenticated requests with 401 before the handler runs.
 *
 * TODO(admin-role): when an operator/admin role lands in the schema, add a role check here
 * (or in a dedicated guard) so only operators — not every authenticated user — can enqueue
 * extraction jobs or read their status.
 *
 * Testability: enqueuing touches Redis/BullMQ, so the queue is reached through an injected
 * {@link QueueAccessor} (defaulting to the real {@link getPyqExtractionQueue}). The pure
 * body validation and job-data assembly live in `./validation`. Together this lets unit
 * tests exercise both handlers with a mock queue and no live Redis.
 */
import type { AuthContext } from '@/lib/auth';
import { ErrorCode, errorResponse } from '@/lib/errors';
import { getPyqExtractionQueue, QUEUE_NAMES } from '@/lib/queue';
import type { PyqExtractionJobData, PyqExtractionJobResult } from '@/workers/pyqExtraction/types';

import { assembleJobData, validateCreateJobInput } from './validation';

/**
 * The minimal slice of a BullMQ `Job` the GET handler reads: its lifecycle state and the
 * processor's return value (a {@link PyqExtractionJobResult}). Declared as an interface so
 * tests can supply a plain object without a live queue.
 */
export interface AdminQueueJob {
    getState(): Promise<string>;
    /** The processor's resolved result; absent/null until the job has completed. */
    returnvalue?: PyqExtractionJobResult | null;
}

/**
 * The minimal queue surface these handlers need, structurally compatible with a BullMQ
 * `Queue`. `add` enqueues a job and yields its server-assigned id; `getJob` resolves a job
 * by id (or null/undefined when unknown).
 */
export interface PyqExtractionJobQueue {
    add(name: string, data: PyqExtractionJobData): Promise<{ id?: string | null }>;
    getJob(id: string): Promise<AdminQueueJob | null | undefined>;
}

/** Supplies the queue. Injectable so tests avoid a live Redis/BullMQ connection. */
export type QueueAccessor = () => PyqExtractionJobQueue;

/** Default accessor: the real shared `pyq-extraction` queue producer (task 1.2). */
const defaultQueueAccessor: QueueAccessor = () =>
    getPyqExtractionQueue() as unknown as PyqExtractionJobQueue;

/** Safely parse a JSON request body, returning `undefined` when absent/invalid. */
async function readJsonBody(request: Request): Promise<unknown> {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

/**
 * Handle `POST /api/admin/pyq-extraction/jobs`. Validates the body, assembles the job
 * payload, enqueues a `pyq-extraction` job, and returns `202 { jobId }`. The route file
 * wraps this with `withAuth` so unauthenticated requests are rejected upstream.
 *
 * @param queueAccessor - injected for testability; defaults to the real queue.
 */
export async function createPyqExtractionJobHandler(
    request: Request,
    _auth: AuthContext,
    queueAccessor: QueueAccessor = defaultQueueAccessor,
): Promise<Response> {
    const body = await readJsonBody(request);
    if (typeof body !== 'object' || body === null) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            'Request body must be a JSON object.',
        );
    }

    const validation = validateCreateJobInput(body as Record<string, unknown>);
    if (!validation.ok) {
        return errorResponse(
            422,
            ErrorCode.VALIDATION_ERROR,
            validation.message,
            validation.details,
        );
    }

    const jobData = assembleJobData(validation.value);
    const queue = queueAccessor();
    const job = await queue.add(QUEUE_NAMES.PYQ_EXTRACTION, jobData);

    // 202 Accepted: the work is queued for asynchronous processing by the worker.
    return Response.json({ jobId: job.id }, { status: 202 });
}

/** Framework route context for the dynamic `/:id` segment. */
export interface PyqExtractionJobRouteContext {
    params: { id: string };
}

/**
 * Handle `GET /api/admin/pyq-extraction/jobs/:id`. Reads the BullMQ job's state and return
 * value and reports `{ status, produced, flaggedForReview }`. A missing job yields
 * `404 NOT_FOUND`. Until the job has completed it has no return value, so `produced` and
 * `flaggedForReview` default to 0.
 *
 * @param queueAccessor - injected for testability; defaults to the real queue.
 */
export async function getPyqExtractionJobHandler(
    _request: Request,
    _auth: AuthContext,
    routeContext: PyqExtractionJobRouteContext,
    queueAccessor: QueueAccessor = defaultQueueAccessor,
): Promise<Response> {
    const { id } = routeContext.params;
    if (typeof id !== 'string' || id.trim() === '') {
        return errorResponse(422, ErrorCode.VALIDATION_ERROR, 'A job id is required.', {
            field: 'id',
        });
    }

    const queue = queueAccessor();
    const job = await queue.getJob(id);
    if (!job) {
        return errorResponse(404, ErrorCode.NOT_FOUND, 'Extraction job not found.');
    }

    const status = await job.getState();
    const result = job.returnvalue ?? null;

    return Response.json({
        status,
        produced: result?.produced ?? 0,
        flaggedForReview: result?.flaggedForReview ?? 0,
    });
}
