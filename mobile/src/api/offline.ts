/**
 * Offline download + sync API calls (task 21.9).
 *
 * Typed wrappers over the Backend_API Offline Sync Handler endpoints (design "Offline Sync
 * Handler", "Offline-Sync Approach"; Req 21.1, 21.4, 21.5):
 *
 *   GET  /offline/papers/:id/bundle  -> { paper, answerKey }   (download for read-only offline use)
 *   POST /sync   { records: LocalSyncRecord[] }
 *        -> { results: [{ clientId, serverId, status: "CREATED"|"DUPLICATE", score? }] }
 *
 * The bundle INCLUDES the answer key on purpose (the device must score locally while offline);
 * the canonical score is always re-derived server-side on `POST /sync`, so trusting the bundle
 * locally never affects the authoritative result. The wire shapes below mirror the backend
 * `bundleService`/`syncService` contracts and the per-type payload validators
 * (`focusValidation`, `pyqAttemptValidation`, `timedPaperValidation`).
 */

import { request } from './client';

// ── Paper bundle (download) ─────────────────────────────────────────────────────────────────

/** A question as carried in the offline bundle (includes `correctOption` for local scoring). */
export interface BundleQuestion {
    id: string;
    examTrack: string;
    year: number;
    subjectId: string;
    questionText: string;
    options: string[];
    correctOption: number;
    flaggedForReview: boolean;
}

/** The paper portion of the bundle (its questions travel with it). */
export interface BundlePaper {
    id: string;
    examTrack: string;
    year: number;
    session: string | null;
    durationMin: number;
    questions: BundleQuestion[];
}

/** The official answer key portion of the bundle. `entries` maps questionRef → correctOption. */
export interface BundleAnswerKey {
    id: string;
    paperId: string;
    entries: Record<string, number>;
}

/** Response of `GET /offline/papers/:id/bundle` — the downloadable PYQ_Paper + Answer_Key. */
export interface PaperBundle {
    paper: BundlePaper;
    answerKey: BundleAnswerKey;
}

// ── Sync outbox (Local_Sync_Records) ────────────────────────────────────────────────────────

/** The activity kinds captured offline and synced on reconnect (mirrors `SyncRecordType`). */
export type SyncRecordType = 'FOCUS_SESSION' | 'PYQ_ATTEMPT' | 'TIMED_PAPER_ATTEMPT';

/** A single answer in a PYQ/Timed attempt payload (`selectedOption` null/omitted = unanswered). */
export interface SyncAnswer {
    questionId: string;
    selectedOption?: number | null;
}

/** Focus session payload (mirrors the server's `focusValidation` input). */
export interface FocusSessionPayload {
    subjectId: string;
    /** ISO-8601 wall-clock start. */
    startTime: string;
    /** ISO-8601 wall-clock end. */
    endTime: string;
    /** Accumulated focused minutes (excludes paused time; integer > 0). */
    focusedDurationMin: number;
    /** One of the five Session_Types; defaults server-side to NEW_CHAPTER when omitted. */
    sessionType?: string;
}

/** PYQ attempt payload (mirrors the server's `pyqAttemptValidation` input). */
export interface PyqAttemptPayload {
    paperOrSetRef: string;
    answers: SyncAnswer[];
}

/** Timed paper attempt payload (mirrors the server's `timedPaperValidation` input). */
export interface TimedAttemptPayload {
    paperId: string;
    answers: SyncAnswer[];
    timeTakenSec: number;
}

/**
 * A queued offline activity record. The top-level `clientId` is authoritative for idempotency
 * (Req 21.3/21.5): the server keys `(userId, clientId)` and never duplicates a re-sent record.
 */
export type LocalSyncRecord =
    | { clientId: string; type: 'FOCUS_SESSION'; payload: FocusSessionPayload }
    | { clientId: string; type: 'PYQ_ATTEMPT'; payload: PyqAttemptPayload }
    | { clientId: string; type: 'TIMED_PAPER_ATTEMPT'; payload: TimedAttemptPayload };

/** One reconciliation result returned by `POST /sync`. */
export interface SyncResultItem {
    clientId: string;
    /** Canonical server id of the created/duplicate row. */
    serverId: string;
    /** `CREATED` (newly persisted) or `DUPLICATE` (already synced — idempotent, Req 21.5). */
    status: 'CREATED' | 'DUPLICATE';
    /** Server-computed authoritative score, present for scored types (PYQ/Timed). */
    score?: number;
}

/** Response of `POST /sync`. */
export interface SyncResponse {
    results: SyncResultItem[];
}

// ── Calls ───────────────────────────────────────────────────────────────────────────────────

/**
 * `GET /offline/papers/:id/bundle` — download a paper + answer key for read-only offline use
 * (Req 21.1). Throws {@link import('./client').ApiError} on 4xx/5xx (e.g. 404 NOT_FOUND).
 */
export function fetchPaperBundle(paperId: string, signal?: AbortSignal): Promise<PaperBundle> {
    return request<PaperBundle>(`/offline/papers/${encodeURIComponent(paperId)}/bundle`, {
        signal,
    });
}

/**
 * `POST /sync` — flush the client outbox. The server upserts idempotently keyed by
 * `(userId, clientId)` and returns canonical ids + computed scores (Req 21.4/21.5).
 */
export function syncRecords(records: LocalSyncRecord[], signal?: AbortSignal): Promise<SyncResponse> {
    return request<SyncResponse>('/sync', { method: 'POST', body: { records }, signal });
}
