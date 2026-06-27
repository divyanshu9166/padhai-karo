/**
 * Pure idempotent-sync reconciliation decision (task 18.1; design "Idempotent Offline Sync
 * Reconciliation"; Req 21.5).
 *
 * The reconciliation rule from the design is, for each incoming `LocalSyncRecord`:
 *   1. Look up `(userId, clientId)` in the `LocalSyncRecord` ledger.
 *   2. If found → return the existing `serverId` with status `DUPLICATE`; create nothing.
 *   3. If not found → create the target record, compute its score where applicable, write
 *      the ledger row, and return `CREATED` with the server id and score.
 *
 * Steps 1–2 are a pure function of "the ledger I have already seen" and the record's
 * `clientId`. {@link decideSyncAction} isolates exactly that decision so the idempotency
 * guarantee is unit-testable without any database: given a map of already-synced
 * `clientId -> serverId`, a known `clientId` decides `DUPLICATE` (carrying the existing
 * server id) and an unknown one decides `CREATE`. The service layer performs the actual
 * creation (step 3) and folds each freshly-created `clientId` back into the map so a
 * repeated `clientId` *within the same batch* also reconciles to `DUPLICATE`.
 */

/** Outcome status reported for each reconciled record (matches the API response). */
export type SyncStatus = 'CREATED' | 'DUPLICATE';

/**
 * The decision for a single record: either it duplicates an already-synced record (and we
 * surface its existing `serverId`), or it is new and must be created.
 */
export type SyncDecision =
    | { action: 'DUPLICATE'; serverId: string }
    | { action: 'CREATE' };

/**
 * Decide whether a record identified by `clientId` is a duplicate of an already-synced
 * record or must be created (Req 21.5).
 *
 * @param existingByClientId - map of already-synced `clientId -> serverId` (the ledger rows
 *   loaded for this user, plus any created earlier in the same batch).
 * @param clientId - the client-generated identifier of the record being reconciled.
 * @returns `DUPLICATE` with the existing server id when the `clientId` is already known,
 *   otherwise `CREATE`.
 */
export function decideSyncAction(
    existingByClientId: ReadonlyMap<string, string>,
    clientId: string,
): SyncDecision {
    const serverId = existingByClientId.get(clientId);
    if (serverId !== undefined) {
        return { action: 'DUPLICATE', serverId };
    }
    return { action: 'CREATE' };
}

/** The reconciliation result for a single record, as returned by `POST /sync`. */
export interface SyncRecordResult {
    clientId: string;
    serverId: string;
    status: SyncStatus;
    /** The authoritative server-computed score (PYQ / timed attempts only). */
    score?: number;
}
