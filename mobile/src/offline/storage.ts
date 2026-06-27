/**
 * On-device offline store (task 21.9; Req 21.1, 21.3).
 *
 * STORAGE CHOICE — AsyncStorage (documented decision):
 *   The design's "Offline-Sync Approach" lists SQLite / expo-file-system / AsyncStorage as
 *   acceptable backends. We use `@react-native-async-storage/async-storage` because it is the
 *   only one already installed in this project (it also backs the session-token fallback in
 *   `state/tokenStorage`), so the offline store works without adding a native dependency that
 *   cannot be installed/prebuilt in this environment. Phase-1 bundles are small structured
 *   JSON (no large media), so a key/value JSON store is sufficient. If bundles later carry
 *   binary media, the seam is small: swap this module's two collections to expo-sqlite +
 *   expo-file-system without touching callers.
 *
 * Two collections, each persisted under one key as JSON:
 *   - `offline:downloads` — a map of paperId → {@link StoredOfflineDownload} (Offline_Downloads).
 *   - `offline:outbox`    — an ordered array of {@link OutboxEntry} (the Local_Sync_Record queue).
 *
 * All reads tolerate missing/corrupt data by returning an empty collection, so a parse failure
 * degrades to "nothing stored" rather than crashing the app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LocalSyncRecord, PaperBundle } from '@/api';
import type { OutboxEntry, StoredOfflineDownload } from './types';

const DOWNLOADS_KEY = 'offline:downloads';
const OUTBOX_KEY = 'offline:outbox';

// ── internal helpers ────────────────────────────────────────────────────────────────────────

async function readJson<T>(key: string, fallback: T): Promise<T> {
    try {
        const raw = await AsyncStorage.getItem(key);
        if (raw === null) {
            return fallback;
        }
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

async function writeJson(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ── Offline_Downloads (Req 21.1) ─────────────────────────────────────────────────────────────

type DownloadMap = Record<string, StoredOfflineDownload>;

/** All downloaded bundles, newest first. */
export async function listDownloads(): Promise<StoredOfflineDownload[]> {
    const map = await readJson<DownloadMap>(DOWNLOADS_KEY, {});
    return Object.values(map).sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
}

/** A single downloaded bundle by paper id, or `null` when not downloaded. */
export async function getDownload(paperId: string): Promise<StoredOfflineDownload | null> {
    const map = await readJson<DownloadMap>(DOWNLOADS_KEY, {});
    return map[paperId] ?? null;
}

/**
 * Persist a downloaded bundle as an Offline_Download (Req 21.1). Re-downloading the same paper
 * overwrites the prior copy and refreshes `downloadedAt`.
 */
export async function saveDownload(bundle: PaperBundle): Promise<StoredOfflineDownload> {
    const map = await readJson<DownloadMap>(DOWNLOADS_KEY, {});
    const entry: StoredOfflineDownload = {
        paperId: bundle.paper.id,
        downloadedAt: new Date().toISOString(),
        bundle,
    };
    map[bundle.paper.id] = entry;
    await writeJson(DOWNLOADS_KEY, map);
    return entry;
}

/** Remove a downloaded bundle from the device. */
export async function deleteDownload(paperId: string): Promise<void> {
    const map = await readJson<DownloadMap>(DOWNLOADS_KEY, {});
    if (paperId in map) {
        delete map[paperId];
        await writeJson(DOWNLOADS_KEY, map);
    }
}

// ── Outbox of Local_Sync_Records (Req 21.3) ───────────────────────────────────────────────────

/** The full outbox in enqueue order (oldest first). */
export async function listOutbox(): Promise<OutboxEntry[]> {
    return readJson<OutboxEntry[]>(OUTBOX_KEY, []);
}

/**
 * Append a captured activity record to the outbox (Req 21.3). A record whose `clientId` is
 * already queued is ignored (de-duplicated locally) so repeated captures never enqueue twice.
 */
export async function enqueue(record: LocalSyncRecord): Promise<OutboxEntry[]> {
    const outbox = await readJson<OutboxEntry[]>(OUTBOX_KEY, []);
    if (outbox.some((entry) => entry.record.clientId === record.clientId)) {
        return outbox;
    }
    const next: OutboxEntry[] = [...outbox, { record, enqueuedAt: new Date().toISOString() }];
    await writeJson(OUTBOX_KEY, next);
    return next;
}

/**
 * Remove the given `clientId`s from the outbox (called after a successful sync). Returns the
 * remaining entries.
 */
export async function removeFromOutbox(clientIds: readonly string[]): Promise<OutboxEntry[]> {
    const drop = new Set(clientIds);
    const outbox = await readJson<OutboxEntry[]>(OUTBOX_KEY, []);
    const next = outbox.filter((entry) => !drop.has(entry.record.clientId));
    if (next.length !== outbox.length) {
        await writeJson(OUTBOX_KEY, next);
    }
    return next;
}

/** Empty the outbox entirely (rarely needed; mainly for diagnostics/tests). */
export async function clearOutbox(): Promise<void> {
    await AsyncStorage.removeItem(OUTBOX_KEY);
}
