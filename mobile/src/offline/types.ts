/**
 * Local offline-store domain types (task 21.9; Req 21.1, 21.3).
 *
 * These wrap the on-the-wire DTOs (`@/api`) with the small amount of device-side metadata the
 * local store keeps: when a paper was downloaded and when an outbox record was enqueued. The
 * primary storage is on-device (design "Offline-Sync Approach"); see `storage.ts` for the
 * chosen backend (AsyncStorage) and the rationale.
 */

import type { LocalSyncRecord, PaperBundle } from '@/api';

/**
 * An `Offline_Download`: a downloaded PYQ_Paper + Answer_Key bundle stored on-device for
 * read-only use while offline (Req 21.1). Keyed by `paperId`.
 */
export interface StoredOfflineDownload {
    paperId: string;
    /** ISO-8601 timestamp of when the bundle was downloaded. */
    downloadedAt: string;
    /** The full downloaded bundle (paper + answer key) used to view/score locally. */
    bundle: PaperBundle;
}

/**
 * An outbox entry: a `Local_Sync_Record` captured offline and queued for sync (Req 21.3),
 * plus the time it was enqueued (for display/ordering). The record's `clientId` is the
 * idempotency key the server reconciles on (Req 21.5).
 */
export interface OutboxEntry {
    record: LocalSyncRecord;
    /** ISO-8601 timestamp of when the record was queued. */
    enqueuedAt: string;
}
