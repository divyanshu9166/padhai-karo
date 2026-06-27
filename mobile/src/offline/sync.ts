/**
 * Outbox sync runner (task 21.9; Req 21.4, 21.5).
 *
 * On reconnect the client flushes its outbox to `POST /sync`. The Backend_API upserts each
 * record idempotently keyed by `(userId, clientId)` and returns, per record, a `CREATED` or
 * `DUPLICATE` status plus the canonical server id and (for scored types) the score. Because
 * BOTH outcomes mean the server now holds the record, every returned `clientId` is removed
 * from the local outbox — re-sending the same record can never duplicate it server-side
 * (Req 21.5), so this reconciliation is safe to retry.
 *
 * The runner is written against injected dependencies (the storage functions and the `/sync`
 * call) so the reconciliation logic is unit-testable without AsyncStorage or the network. The
 * default `runSync` wires the real storage + API.
 */

import { syncRecords as defaultSyncRecords, type LocalSyncRecord, type SyncResultItem } from '@/api';
import { listOutbox as defaultListOutbox, removeFromOutbox as defaultRemoveFromOutbox } from './storage';

/** Summary of a single sync pass. */
export interface SyncRunResult {
    /** Number of records that were in the outbox and sent. */
    attempted: number;
    /** Number of records the server acknowledged (CREATED or DUPLICATE) and were cleared. */
    synced: number;
    /** Number of records still queued after the pass. */
    remaining: number;
    /** The per-record results returned by the server (empty when nothing was sent). */
    results: SyncResultItem[];
}

/** Injectable collaborators (defaulted to the real storage + API in {@link runSync}). */
export interface SyncDeps {
    listOutbox: () => Promise<Array<{ record: LocalSyncRecord }>>;
    removeFromOutbox: (clientIds: readonly string[]) => Promise<unknown>;
    sync: (records: LocalSyncRecord[]) => Promise<{ results: SyncResultItem[] }>;
}

/**
 * Flush the outbox once. Returns immediately with a zeroed result when the outbox is empty.
 * On a network/API failure the call rejects and the outbox is left intact for a later retry
 * (nothing is removed unless the server acknowledged it).
 */
export async function runSyncWith(deps: SyncDeps): Promise<SyncRunResult> {
    const entries = await deps.listOutbox();
    if (entries.length === 0) {
        return { attempted: 0, synced: 0, remaining: 0, results: [] };
    }

    const records = entries.map((entry) => entry.record);
    const { results } = await deps.sync(records);

    // Every acknowledged record (CREATED or DUPLICATE) is now on the server — clear them.
    const acknowledged = results.map((result) => result.clientId);
    await deps.removeFromOutbox(acknowledged);

    const remaining = await deps.listOutbox();
    return {
        attempted: records.length,
        synced: acknowledged.length,
        remaining: remaining.length,
        results,
    };
}

/** Flush the outbox using the real on-device storage and the `/sync` endpoint. */
export function runSync(): Promise<SyncRunResult> {
    return runSyncWith({
        listOutbox: defaultListOutbox,
        removeFromOutbox: defaultRemoveFromOutbox,
        sync: defaultSyncRecords,
    });
}
