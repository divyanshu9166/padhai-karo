/**
 * POST /api/sync (task 18.1, design "Offline Sync Handler").
 *
 * Accepts the Mobile_Client's offline outbox and idempotently reconciles each
 * `LocalSyncRecord` keyed by `(userId, clientId)` (Req 21.5). Guarded per the design
 * "Authentication Posture" by {@link withAuth} (task 2.3): unauthenticated requests are
 * rejected with 401 UNAUTHORIZED before the handler runs. The handler creates the target
 * activity row (focus session / PYQ attempt / timed attempt), computes the authoritative
 * score server-side where applicable, writes the idempotency ledger row in a transaction,
 * and returns canonical server ids + scores with status CREATED/DUPLICATE.
 *
 * The handler logic lives in the sync service so it stays free of framework/guard concerns.
 */
import { withAuth } from '@/lib/auth';
import { syncHandler } from '@/services/sync';

export const POST = withAuth((request, ctx) => syncHandler(request, ctx));
