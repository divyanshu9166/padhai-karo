/**
 * Pure validation + job-data assembly for the operator PYQ-extraction job endpoints
 * (task 12.2; design "PYQ Extraction Pipeline (Worker, Req 7)"; Req 7.1, 7.3).
 *
 *   POST /api/admin/pyq-extraction/jobs
 *     body: { sourceImageRefs[], track, year, subjectId, answerKeyId, paperId? }
 *
 * This module holds ONLY the framework- and infrastructure-free decision logic: it
 * validates/normalizes the request body and assembles the {@link PyqExtractionJobData}
 * payload that gets enqueued onto the `pyq-extraction` BullMQ queue. Keeping it pure means
 * the rules can be unit-tested without Redis/BullMQ and reused by the thin route handler.
 *
 * Validation rules (422 on any failure):
 *   - `sourceImageRefs` is a non-empty array of non-blank strings.
 *   - `track` is a valid Exam_Track (`JEE` or `NEET`).
 *   - `year` is an integer.
 *   - `subjectId` and `answerKeyId` are required non-blank strings.
 *   - `paperId` is optional; when present it must be a non-blank string (else normalized
 *     to null for an ad-hoc question set).
 *
 * Note the request field is named `track` (per the design request shape) while the worker
 * job payload names it `examTrack`; {@link assembleJobData} performs that mapping.
 */
import type { ExamTrack } from '@prisma/client';

import type { PyqExtractionJobData } from '@/workers/pyqExtraction/types';

/** Raw, untrusted create-job input as received from the request body. */
export interface CreateJobInput {
    sourceImageRefs?: unknown;
    track?: unknown;
    year?: unknown;
    subjectId?: unknown;
    answerKeyId?: unknown;
    paperId?: unknown;
}

/** A validated, normalized create-job request ready to assemble into a job payload. */
export interface ValidatedCreateJob {
    sourceImageRefs: string[];
    track: ExamTrack;
    year: number;
    subjectId: string;
    answerKeyId: string;
    paperId: string | null;
}

/** Discriminated result of {@link validateCreateJobInput}. */
export type CreateJobValidation =
    | { ok: true; value: ValidatedCreateJob }
    | { ok: false; message: string; details?: Record<string, unknown> };

/** The only Exam_Track values the schema supports (Req 7.4). */
const VALID_TRACKS: ReadonlySet<string> = new Set<ExamTrack>(['JEE', 'NEET']);

/**
 * Validate and normalize a create-job request (Req 7.1/7.3). Pure: performs no I/O and
 * never touches Redis/BullMQ, so the caller owns enqueuing and response shaping.
 *
 * Checks run in declaration order so the first offending field is reported.
 */
export function validateCreateJobInput(input: CreateJobInput): CreateJobValidation {
    // 1. sourceImageRefs must be a non-empty array of non-blank strings.
    if (!Array.isArray(input.sourceImageRefs) || input.sourceImageRefs.length === 0) {
        return {
            ok: false,
            message: '"sourceImageRefs" must be a non-empty array.',
            details: { field: 'sourceImageRefs' },
        };
    }
    const sourceImageRefs: string[] = [];
    for (let i = 0; i < input.sourceImageRefs.length; i += 1) {
        const ref = input.sourceImageRefs[i] as unknown;
        if (typeof ref !== 'string' || ref.trim() === '') {
            return {
                ok: false,
                message: `"sourceImageRefs[${i}]" must be a non-blank string.`,
                details: { field: `sourceImageRefs[${i}]` },
            };
        }
        sourceImageRefs.push(ref.trim());
    }

    // 2. track must be a valid Exam_Track.
    if (typeof input.track !== 'string' || !VALID_TRACKS.has(input.track)) {
        return {
            ok: false,
            message: '"track" must be one of JEE, NEET.',
            details: { field: 'track' },
        };
    }
    const track = input.track as ExamTrack;

    // 3. year must be an integer.
    if (typeof input.year !== 'number' || !Number.isInteger(input.year)) {
        return {
            ok: false,
            message: '"year" must be an integer.',
            details: { field: 'year' },
        };
    }
    const year = input.year;

    // 4. subjectId is a required non-blank string.
    if (typeof input.subjectId !== 'string' || input.subjectId.trim() === '') {
        return {
            ok: false,
            message: '"subjectId" is required.',
            details: { field: 'subjectId' },
        };
    }
    const subjectId = input.subjectId.trim();

    // 5. answerKeyId is a required non-blank string.
    if (typeof input.answerKeyId !== 'string' || input.answerKeyId.trim() === '') {
        return {
            ok: false,
            message: '"answerKeyId" is required.',
            details: { field: 'answerKeyId' },
        };
    }
    const answerKeyId = input.answerKeyId.trim();

    // 6. paperId is optional; a present value must be a non-blank string.
    let paperId: string | null = null;
    if (input.paperId !== undefined && input.paperId !== null) {
        if (typeof input.paperId !== 'string' || input.paperId.trim() === '') {
            return {
                ok: false,
                message: '"paperId" must be a non-blank string when provided.',
                details: { field: 'paperId' },
            };
        }
        paperId = input.paperId.trim();
    }

    return {
        ok: true,
        value: { sourceImageRefs, track, year, subjectId, answerKeyId, paperId },
    };
}

/**
 * Assemble the {@link PyqExtractionJobData} enqueued onto the `pyq-extraction` queue from a
 * validated request. Pure mapping — notably renames the request's `track` to the worker
 * payload's `examTrack` (Req 7.4). Kept separate from validation so both can be unit-tested
 * in isolation and the handler stays a thin enqueue shell.
 */
export function assembleJobData(value: ValidatedCreateJob): PyqExtractionJobData {
    return {
        sourceImageRefs: value.sourceImageRefs,
        examTrack: value.track,
        year: value.year,
        subjectId: value.subjectId,
        answerKeyId: value.answerKeyId,
        paperId: value.paperId,
    };
}
