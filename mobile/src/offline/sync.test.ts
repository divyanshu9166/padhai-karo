import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalSyncRecord, SyncResultItem } from '@/api';

// `./sync` transitively imports the real `@/api` (the `/sync` call) and `./storage` (which
// pulls in AsyncStorage). Replace both so the module loads in a plain Node test; the reconcile
// logic under test runs against injected fakes, not these mocks.
vi.mock('@/api', () => ({ syncRecords: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
    default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

import { runSyncWith, type SyncDeps } from './sync';

/** A minimal focus-session record for the outbox. */
function focusRecord(clientId: string): LocalSyncRecord {
    return {
        clientId,
        type: 'FOCUS_SESSION',
        payload: {
            subjectId: 'PHY',
            startTime: '2024-01-01T10:00:00.000Z',
            endTime: '2024-01-01T10:30:00.000Z',
            focusedDurationMin: 30,
        },
    };
}

/**
 * Build injectable deps backed by an in-memory outbox. `serverResults` decides what `/sync`
 * returns; `removeFromOutbox` mutates the in-memory list exactly like the real store.
 */
function makeDeps(
    initialClientIds: string[],
    serverResults: (records: LocalSyncRecord[]) => SyncResultItem[],
): SyncDeps & { current(): string[] } {
    let outbox = initialClientIds.map((clientId) => ({ record: focusRecord(clientId) }));
    return {
        listOutbox: async () => outbox,
        removeFromOutbox: async (clientIds: readonly string[]) => {
            const drop = new Set(clientIds);
            outbox = outbox.filter((entry) => !drop.has(entry.record.clientId));
            return outbox;
        },
        sync: async (records: LocalSyncRecord[]) => ({ results: serverResults(records) }),
        current: () => outbox.map((entry) => entry.record.clientId),
    };
}

describe('runSyncWith', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns a zeroed result and never calls the server for an empty outbox', async () => {
        const sync = vi.fn();
        const result = await runSyncWith({
            listOutbox: async () => [],
            removeFromOutbox: async () => undefined,
            sync,
        });

        expect(result).toEqual({ attempted: 0, synced: 0, remaining: 0, results: [] });
        expect(sync).not.toHaveBeenCalled();
    });

    it('clears every acknowledged record — both CREATED and DUPLICATE (Req 21.5)', async () => {
        const deps = makeDeps(['a', 'b'], (records) =>
            records.map((r, i) => ({
                clientId: r.clientId,
                serverId: `srv-${r.clientId}`,
                status: i === 0 ? 'CREATED' : 'DUPLICATE',
            })),
        );

        const result = await runSyncWith(deps);

        expect(result.attempted).toBe(2);
        expect(result.synced).toBe(2);
        expect(result.remaining).toBe(0);
        expect(deps.current()).toEqual([]);
    });

    it('keeps records the server did not acknowledge so they retry next pass', async () => {
        // Server acknowledges only 'a'; 'b' must remain queued.
        const deps = makeDeps(['a', 'b'], () => [
            { clientId: 'a', serverId: 'srv-a', status: 'CREATED' },
        ]);

        const result = await runSyncWith(deps);

        expect(result.attempted).toBe(2);
        expect(result.synced).toBe(1);
        expect(result.remaining).toBe(1);
        expect(deps.current()).toEqual(['b']);
    });

    it('propagates a sync failure and leaves the outbox intact for retry', async () => {
        const deps = makeDeps(['a'], () => {
            throw new Error('network down');
        });

        await expect(runSyncWith(deps)).rejects.toThrow('network down');
        expect(deps.current()).toEqual(['a']);
    });
});
