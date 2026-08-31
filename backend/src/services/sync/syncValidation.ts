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
    'ANSWER_WRITING_ATTEMPT',
    'WELLBEING_CHECKIN',
    'VOICE_NOTE',
    'NOTE_SUMMARY',
    'STUDY_RESOURCE',
];

export interface ValidatedAnswerWritingPayload { prompt: string; answerText: string; subjectId?: string; timeTakenSec?: number; }
export interface ValidatedWellbeingPayload { checkinDate: Date; mood: number; energy: number; stress: number; sleepHours?: number; note?: string; }
export interface ValidatedVoiceNotePayload { title: string; audioUri?: string; transcription?: string; durationSec?: number; subjectId?: string; chapterId?: string; tags?: string[]; }
export interface ValidatedNoteSummaryPayload { inputType: 'TEXT' | 'PHOTO' | 'VOICE'; summary: Record<string, unknown>; }
export interface ValidatedStudyResourcePayload { title: string; url?: string; type?: string; tags: string[]; subjectId?: string; chapterId?: string; }

/**
 * A validated, normalized sync record ready to reconcile + persist. The `payload` is
 * discriminated by `type` so the service layer can create the correct target row with full
 * type-safety.
 */
export type ValidatedSyncRecord =
    | { clientId: string; type: 'FOCUS_SESSION'; payload: ValidatedFocusSession }
    | { clientId: string; type: 'PYQ_ATTEMPT'; payload: ValidatedPyqAttempt }
    | { clientId: string; type: 'TIMED_PAPER_ATTEMPT'; payload: ValidatedTimedAttempt }
    | { clientId: string; type: 'ANSWER_WRITING_ATTEMPT'; payload: ValidatedAnswerWritingPayload }
    | { clientId: string; type: 'WELLBEING_CHECKIN'; payload: ValidatedWellbeingPayload }
    | { clientId: string; type: 'VOICE_NOTE'; payload: ValidatedVoiceNotePayload }
    | { clientId: string; type: 'NOTE_SUMMARY'; payload: ValidatedNoteSummaryPayload }
    | { clientId: string; type: 'STUDY_RESOURCE'; payload: ValidatedStudyResourcePayload };

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
        case 'ANSWER_WRITING_ATTEMPT': {
            const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
            const answerText = typeof payload.answerText === 'string' ? payload.answerText.trim() : '';
            if (!prompt || !answerText || answerText.length > 50_000) return { ok: false, message: 'answer-writing prompt and answerText are required.', details: { field: `records[${index}].payload` } };
            return { ok: true, record: { clientId: '', type, payload: { prompt, answerText, subjectId: typeof payload.subjectId === 'string' ? payload.subjectId : undefined, timeTakenSec: typeof payload.timeTakenSec === 'number' ? payload.timeTakenSec : undefined } } };
        }
        case 'WELLBEING_CHECKIN': {
            const date = typeof payload.checkinDate === 'string' ? new Date(payload.checkinDate) : new Date();
            const values = [payload.mood, payload.energy, payload.stress];
            if (Number.isNaN(date.getTime()) || values.some((value) => typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5)) return { ok: false, message: 'wellbeing values must be integers from 1 to 5.', details: { field: `records[${index}].payload` } };
            return { ok: true, record: { clientId: '', type, payload: { checkinDate: date, mood: payload.mood as number, energy: payload.energy as number, stress: payload.stress as number, sleepHours: typeof payload.sleepHours === 'number' ? payload.sleepHours : undefined, note: typeof payload.note === 'string' ? payload.note.trim() : undefined } } };
        }
        case 'VOICE_NOTE': {
            const title = typeof payload.title === 'string' ? payload.title.trim() : '';
            if (!title) return { ok: false, message: 'voice-note title is required.', details: { field: `records[${index}].payload.title` } };
            return { ok: true, record: { clientId: '', type, payload: { title, audioUri: typeof payload.audioUri === 'string' ? payload.audioUri : undefined, transcription: typeof payload.transcription === 'string' ? payload.transcription : undefined, durationSec: typeof payload.durationSec === 'number' ? payload.durationSec : undefined, subjectId: typeof payload.subjectId === 'string' ? payload.subjectId : undefined, chapterId: typeof payload.chapterId === 'string' ? payload.chapterId : undefined, tags: Array.isArray(payload.tags) ? payload.tags.filter((item): item is string => typeof item === 'string').slice(0, 20) : undefined } } };
        }
        case 'NOTE_SUMMARY': {
            const inputType = payload.inputType === 'TEXT' || payload.inputType === 'PHOTO' || payload.inputType === 'VOICE' ? payload.inputType : null;
            const summary = payload.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary) ? payload.summary as Record<string, unknown> : null;
            if (!inputType || !summary) return { ok: false, message: 'offline note summary needs a valid inputType and summary object.', details: { field: `records[${index}].payload` } };
            return { ok: true, record: { clientId: '', type, payload: { inputType, summary } } };
        }
        case 'STUDY_RESOURCE': {
            const title = typeof payload.title === 'string' ? payload.title.trim() : '';
            if (!title) return { ok: false, message: 'offline resource title is required.', details: { field: `records[${index}].payload.title` } };
            return { ok: true, record: { clientId: '', type, payload: { title, url: typeof payload.url === 'string' ? payload.url.trim() || undefined : undefined, type: typeof payload.type === 'string' ? payload.type.trim() || undefined : undefined, tags: Array.isArray(payload.tags) ? payload.tags.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 30) : [], subjectId: typeof payload.subjectId === 'string' ? payload.subjectId : undefined, chapterId: typeof payload.chapterId === 'string' ? payload.chapterId : undefined } } };
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
