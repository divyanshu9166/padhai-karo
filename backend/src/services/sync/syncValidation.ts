/**
 * Pure validation for the offline-sync endpoint (task 18.1; design "Offline Sync Handler",
 * "Offline-Sync Approach"; Req 21.5).
 *
 *   POST /api/sync
 *     body: { records: LocalSyncRecord[] }
 *
 * Each incoming record is the client's outbox entry: a client-generated `clientId`, a
 * `type` (FOCUS_SESSION | PYQ_ATTEMPT | TIMED_PAPER_ATTEMPT), and the captured `payload`.
 * This module holds the framework- and database-free decision logic that shapes/validates
 * the request body so it can be unit-tested in isolation and reused by the thin route
 * handler. Idempotent reconciliation (the (userId, clientId) lookup) lives in
 * {@link ./syncReconciliation}; persistence + scoring orchestration live in
 * {@link ./syncService}.
 *
 * Per-type payload validation reuses the SAME validators the online endpoints use
 * ({@link validateFocusSessionInput}, {@link validatePyqAttemptInput},
 * {@link validateTimedAttemptInput}) so an activity captured offline is validated exactly
 * as it would be online — there is no weaker offline path.
 *
 * Note the record's top-level `clientId` is authoritative for idempotency; any `clientId`
 * embedded inside the payload is ignored (the envelope's `clientId` is what is persisted on
 * both the target row and the ledger row).
 */
import type { SyncRecordType } from '@prisma/client';

import {
    validateFocusSessionInput,
    type ValidatedFocusSession,
} from '@/services/focus/focusValidation';
import {
    validatePyqAttemptInput,
    type ValidatedPyqAttempt,
} from '@/services/pyq/pyqAttemptValidation';
import {
    validateTimedAttemptInput,
    type ValidatedTimedAttempt,
} from '@/services/timedPaper/timedPaperValidation';

/**
 * The valid {@link SyncRecordType} values (Req 21.3). Declared explicitly so the validator
 * can reject an unknown type without a database round-trip; kept in sync with the Prisma
 * enum.
 */
export const SYNC_RECORD_TYPES: readonly SyncRecordType[] = [
    'FOCUS_SESSION',
    'PYQ_ATTEMPT',
    'TIMED_PAPER_ATTEMPT',
];

/**
 * A validated, normalized sync record ready to reconcile + persist. The `payload` is
 * discriminated by `type` so the service layer can create the correct target row with full
 * type-safety.
 */
export type ValidatedSyncRecord =
    | { clientId: string; type: 'FOCUS_SESSION'; payload: ValidatedFocusSession }
    | { clientId: string; type: 'PYQ_ATTEMPT'; payload: ValidatedPyqAttempt }
    | { clientId: string; type: 'TIMED_PAPER_ATTEMPT'; payload: ValidatedTimedAttempt };

/** A validated sync request: the list of records to reconcile. */
export interface ValidatedSyncRequest {
    records: ValidatedSyncRecord[];
}

/** Discriminated result of {@link validateSyncInput}. */
export type SyncValidation =
    | { ok: true; value: ValidatedSyncRequest }
    | { ok: false; message: string; details?: Record<string, unknown> };

/** Validate and normalize a single record's payload against its declared `type`. */
function validatePayload(
    type: SyncRecordType,
    payload: Record<string, unknown>,
    index: number,
): SyncValidation | { ok: true; record: ValidatedSyncRecord } {
    switch (type) {
        case 'FOCUS_SESSION': {
            const result = validateFocusSessionInput(payload);
            if (!result.ok) {
                return {
                    ok: false,
                    message: `"records[${index}].payload": ${result.message}`,
                    details: { field: `records[${index}].payload`, cause: result.details },
                };
            }
            return { ok: true, record: { clientId: '', type, payload: result.value } };
        }
        case 'PYQ_ATTEMPT': {
            const result = validatePyqAttemptInput(payload);
            if (!result.ok) {
                return {
                    ok: false,
                    message: `"records[${index}].payload": ${result.message}`,
                    details: { field: `records[${index}].payload`, cause: result.details },
                };
            }
            return { ok: true, record: { clientId: '', type, payload: result.value } };
        }
        case 'TIMED_PAPER_ATTEMPT': {
            const result = validateTimedAttemptInput(payload);
            if (!result.ok) {
                return {
                    ok: false,
                    message: `"records[${index}].payload": ${result.message}`,
                    details: { field: `records[${index}].payload`, cause: result.details },
                };
            }
            return { ok: true, record: { clientId: '', type, payload: result.value } };
        }
        default: {
            // Exhaustiveness guard: never reached because `type` is validated upstream.
            return {
                ok: false,
                message: `"records[${index}].type" is not a supported sync record type.`,
                details: { field: `records[${index}].type` },
            };
        }
    }
}

/**
 * Validate and normalize a `POST /sync` request body (Req 21.5).
 *
 * Checks, in order:
 *   1. body is an object carrying a `records` array.
 *   2. each record is an object with a non-blank `clientId`, a known `type`, and an object
 *      `payload`.
 *   3. each record's `payload` validates against the per-type validator.
 *
 * Pure: performs no I/O and never touches the database, so the caller (the service/route
 * handler) owns idempotent reconciliation, scoring, persistence, and per-user scoping.
 */
export function validateSyncInput(input: unknown): SyncValidation {
    if (typeof input !== 'object' || input === null) {
        return { ok: false, message: 'Request body must be a JSON object.' };
    }

    const { records } = input as { records?: unknown };
    if (!Array.isArray(records)) {
        return {
            ok: false,
            message: '"records" must be an array.',
            details: { field: 'records' },
        };
    }

    const validated: ValidatedSyncRecord[] = [];
    for (let i = 0; i < records.length; i += 1) {
        const entry = records[i] as unknown;
        if (typeof entry !== 'object' || entry === null) {
            return {
                ok: false,
                message: `"records[${i}]" must be an object.`,
                details: { field: `records[${i}]` },
            };
        }

        const { clientId, type, payload } = entry as {
            clientId?: unknown;
            type?: unknown;
            payload?: unknown;
        };

        if (typeof clientId !== 'string' || clientId.trim() === '') {
            return {
                ok: false,
                message: `"records[${i}].clientId" is required.`,
                details: { field: `records[${i}].clientId` },
            };
        }

        if (typeof type !== 'string' || !(SYNC_RECORD_TYPES as string[]).includes(type)) {
            return {
                ok: false,
                message: `"records[${i}].type" must be one of: ${SYNC_RECORD_TYPES.join(', ')}.`,
                details: { field: `records[${i}].type` },
            };
        }

        if (typeof payload !== 'object' || payload === null) {
            return {
                ok: false,
                message: `"records[${i}].payload" must be an object.`,
                details: { field: `records[${i}].payload` },
            };
        }

        const payloadResult = validatePayload(
            type as SyncRecordType,
            payload as Record<string, unknown>,
            i,
        );
        if (!('record' in payloadResult)) {
            return payloadResult;
        }

        validated.push({ ...payloadResult.record, clientId: clientId.trim() });
    }

    return { ok: true, value: { records: validated } };
}
