import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalSyncRecord, PaperBundle } from '@/api';

// In-memory AsyncStorage so the store's read/write/dedupe logic runs in plain Node. `vi.hoisted`
// makes the backing map available to the (hoisted) `vi.mock` factory and to the tests for reset.
const { mem } = vi.hoisted(() => ({ mem: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => (mem.has(key) ? mem.get(key)! : null),
        setItem: async (key: string, value: string) => {
            mem.set(key, value);
        },
        removeItem: async (key: string) => {
            mem.delete(key);
        },
    },
}));

import { enqueue, listOutbox, removeFromOutbox, saveDownload, listDownloads, getDownload } from './storage';

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

function makeBundle(paperId: string): PaperBundle {
    return {
        paper: { id: paperId, examTrack: 'JEE', year: 2024, session: null, durationMin: 60, questions: [] },
        answerKey: { id: `key-${paperId}`, paperId, entries: {} },
    };
}

describe('offline outbox storage', () => {
    beforeEach(() => {
        mem.clear();
    });

    it('appends captured records in enqueue order (Req 21.3)', async () => {
        await enqueue(focusRecord('a'));
        await enqueue(focusRecord('b'));

        const outbox = await listOutbox();
        expect(outbox.map((e) => e.record.clientId)).toEqual(['a', 'b']);
        expect(outbox[0].enqueuedAt).toBeTypeOf('string');
    });

    it('de-duplicates a record whose clientId is already queued', async () => {
        await enqueue(focusRecord('dup'));
        const after = await enqueue(focusRecord('dup'));

        expect(after).toHaveLength(1);
        expect(await listOutbox()).toHaveLength(1);
    });

    it('removes only the acknowledged clientIds, leaving the rest queued', async () => {
        await enqueue(focusRecord('a'));
        await enqueue(focusRecord('b'));
        await enqueue(focusRecord('c'));

        const remaining = await removeFromOutbox(['a', 'c']);

        expect(remaining.map((e) => e.record.clientId)).toEqual(['b']);
        expect((await listOutbox()).map((e) => e.record.clientId)).toEqual(['b']);
    });

    it('tolerates corrupt stored data by reading as an empty outbox', async () => {
        mem.set('offline:outbox', '{not valid json');
        expect(await listOutbox()).toEqual([]);
    });
});

describe('offline downloads storage', () => {
    beforeEach(() => {
        mem.clear();
    });

    it('saves a bundle as an Offline_Download and lists it (Req 21.1)', async () => {
        await saveDownload(makeBundle('p1'));

        const downloads = await listDownloads();
        expect(downloads).toHaveLength(1);
        expect(downloads[0].paperId).toBe('p1');
        expect((await getDownload('p1'))?.bundle.paper.id).toBe('p1');
    });

    it('re-downloading the same paper overwrites rather than duplicates', async () => {
        await saveDownload(makeBundle('p1'));
        await saveDownload(makeBundle('p1'));

        expect(await listDownloads()).toHaveLength(1);
    });
});
