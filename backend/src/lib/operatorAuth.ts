import { ErrorCode, errorResponse } from './errors';

/** Shared operator-key gate for import and extraction endpoints. */
export function requireOperatorKey(request: Request): Response | null {
    const configured = process.env.PYQ_IMPORT_KEY?.trim();
    if (!configured) return errorResponse(503, ErrorCode.REFERENCE_DATA_UNAVAILABLE, 'Operator access is not configured. Set PYQ_IMPORT_KEY before enabling import endpoints.');
    if (request.headers.get('x-pyq-import-key')?.trim() !== configured) return errorResponse(403, ErrorCode.FORBIDDEN, 'A valid operator key is required.');
    return null;
}

/** Separate moderation gate so PYQ import credentials cannot moderate user content. */
export function requireModerationKey(request: Request): Response | null {
    const configured = process.env.MODERATION_KEY?.trim();
    if (!configured) return errorResponse(503, ErrorCode.REFERENCE_DATA_UNAVAILABLE, 'Moderation access is not configured. Set MODERATION_KEY before enabling moderation endpoints.');
    const supplied = request.headers.get('x-moderation-key')?.trim()
        || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (supplied !== configured) return errorResponse(403, ErrorCode.FORBIDDEN, 'A valid moderation key is required.');
    return null;
}
