/**
 * Pure input validation for the AI Notes Service (task 16.1).
 *
 * Kept as small, DB-independent functions so they are unit-testable without a live
 * database or provider. The handler ({@link createSummaryHandler}) wires these to Prisma
 * and the injected {@link AiSummarizer}.
 *
 * Validation runs only AFTER the tier and quota gates (design "AI Notes Request Flow &
 * Usage Accounting"): a free user never reaches validation (402) and a zero-quota paid
 * user never reaches validation (429). When a paid user with remaining quota submits an
 * invalid request, the request is rejected `422` and EXACTLY ONE usage unit is recorded
 * (Req 8.5) without decrementing quota (Req 9.3).
 */
import { ErrorCode } from '@/lib/errors';

import type { AiSummaryInput } from './types';

/** A successful parse yields a normalized {@link AiSummaryInput}. */
export interface ValidInput {
    ok: true;
    value: AiSummaryInput;
}

/** A failed parse carries the error code + message used to build the 422 response. */
export interface InvalidInput {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
}

export type SummaryInputValidation = ValidInput | InvalidInput;

/** Narrowing helper: is `value` a non-array plain object? */
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize the request body for `POST /ai/summaries`.
 *
 * Rules:
 *   - The body must be a JSON object with `inputType` of `"TEXT"` or `"PHOTO"`.
 *   - `TEXT`: `text` must be a string containing at least one non-whitespace character.
 *     Empty/whitespace-only text is rejected with {@link ErrorCode.EMPTY_INPUT} (Req 8.3).
 *   - `PHOTO`: `imageUploadId` must be a non-empty (trimmed) string referencing the
 *     uploaded image.
 *
 * Any failure here is a "validation rejection" — for a paid user with remaining quota the
 * caller records exactly one usage unit (Req 8.5) and does NOT decrement quota.
 */
export function validateSummaryInput(body: unknown): SummaryInputValidation {
    if (!isObject(body)) {
        return {
            ok: false,
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Request body must be a JSON object.',
        };
    }

    const { inputType } = body;

    if (inputType === 'TEXT') {
        const { text } = body;
        if (typeof text !== 'string' || text.trim() === '') {
            return {
                ok: false,
                code: ErrorCode.EMPTY_INPUT,
                message: 'Note text must not be empty or whitespace-only.',
                details: { field: 'text' },
            };
        }
        return { ok: true, value: { inputType: 'TEXT', text } };
    }

    if (inputType === 'PHOTO') {
        const { imageUploadId } = body;
        if (typeof imageUploadId !== 'string' || imageUploadId.trim() === '') {
            return {
                ok: false,
                code: ErrorCode.VALIDATION_ERROR,
                message: 'A photo summarization request requires a non-empty imageUploadId.',
                details: { field: 'imageUploadId' },
            };
        }
        return { ok: true, value: { inputType: 'PHOTO', imageUploadId: imageUploadId.trim() } };
    }

    return {
        ok: false,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'inputType must be "TEXT" or "PHOTO".',
        details: { field: 'inputType' },
    };
}
