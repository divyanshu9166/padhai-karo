import { describe, expect, it } from 'vitest';

import { decideSyncAction } from './syncReconciliation';

/**
 * Example tests for the pure idempotent-sync reconciliation decision (task 18.1).
 *
 * This isolates the (userId, clientId) idempotency rule (Req 21.5) from the database: given
 * a map of already-synced `clientId -> serverId`, a known clientId decides DUPLICATE
 * carrying the existing server id, and an unknown one decides CREATE. The numbered property
 * test (Property 47) is task 18.2.
 *
 * Validates: Requirements 21.5
 */
describe('decideSyncAction', () => {
    it('decides CREATE for an unknown clientId', () => {
        const existing = new Map<string, string>();
        expect(decideSyncAction(existing, 'c-new')).toEqual({ action: 'CREATE' });
    });

    it('decides DUPLICATE with the existing serverId for a known clientId', () => {
        const existing = new Map<string, string>([['c-1', 'server-1']]);
        expect(decideSyncAction(existing, 'c-1')).toEqual({
            action: 'DUPLICATE',
            serverId: 'server-1',
        });
    });

    it('treats distinct clientIds independently', () => {
        const existing = new Map<string, string>([['c-1', 'server-1']]);
        expect(decideSyncAction(existing, 'c-2')).toEqual({ action: 'CREATE' });
    });

    it('reflects a clientId folded in after an in-batch create', () => {
        const existing = new Map<string, string>();
        // First sight: must CREATE.
        expect(decideSyncAction(existing, 'c-1')).toEqual({ action: 'CREATE' });
        // Service folds the created clientId back into the map; second sight is DUPLICATE.
        existing.set('c-1', 'server-1');
        expect(decideSyncAction(existing, 'c-1')).toEqual({
            action: 'DUPLICATE',
            serverId: 'server-1',
        });
    });
});
