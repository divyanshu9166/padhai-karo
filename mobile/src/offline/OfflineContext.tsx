/**
 * Offline state provider + hook (task 21.9; Req 21.1, 21.2, 21.3, 21.4, 21.6).
 *
 * Owns the device-side offline experience and exposes it app-wide:
 *   - Connectivity: tracks online/offline via an injectable {@link ConnectivityMonitor}
 *     (default: a probe-based monitor — see `connectivity.ts`).
 *   - Downloads: lists/downloads/removes Offline_Downloads (Req 21.1) via the local store.
 *   - Outbox: enqueues captured activity as Local_Sync_Records (Req 21.3) and flushes it to
 *     `POST /sync` on reconnect AND on demand (Req 21.4), reconciling idempotently (Req 21.5).
 *   - Unavailable-offline features: a stable list (AI summarizer, NTA feed) other screens can
 *     read to surface the "unavailable offline" indicator (Req 21.6).
 *
 * Sync-on-reconnect: the provider subscribes to the monitor and, on an offline→online (or
 * unknown→online) transition, runs a sync pass. The provider is mounted once near the app root
 * so this happens regardless of which screen is visible.
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';

import { fetchPaperBundle, type LocalSyncRecord } from '@/api';
import {
    ProbeConnectivityMonitor,
    type ConnectivityMonitor,
    type ConnectivityStatus,
} from './connectivity';
import { runSync, type SyncRunResult } from './sync';
import * as store from './storage';
import type { OutboxEntry, StoredOfflineDownload } from './types';

/** Features that require connectivity and are surfaced as unavailable offline (Req 21.6). */
export const OFFLINE_UNAVAILABLE_FEATURES = ['AI_NOTES_SUMMARIZER', 'NTA_FEED'] as const;
export type OfflineUnavailableFeature = (typeof OFFLINE_UNAVAILABLE_FEATURES)[number];

interface OfflineContextValue {
    /** Current reachability (`unknown` until the first probe resolves). */
    status: ConnectivityStatus;
    /** Convenience flag: `true` only once we've confirmed the device is offline. */
    isOffline: boolean;
    /** Downloaded bundles available for read-only offline use (Req 21.1), newest first. */
    downloads: StoredOfflineDownload[];
    /** The queued Local_Sync_Records awaiting sync (Req 21.3), oldest first. */
    outbox: OutboxEntry[];
    /** `true` while a download or sync pass is in flight. */
    busy: boolean;
    /** Features unavailable while offline (Req 21.6). */
    unavailableFeatures: readonly OfflineUnavailableFeature[];
    /** Whether a given feature is currently unavailable (offline + in the unavailable set). */
    isFeatureUnavailable: (feature: OfflineUnavailableFeature) => boolean;
    /** Download a paper bundle and store it on-device (Req 21.1). */
    downloadPaper: (paperId: string) => Promise<StoredOfflineDownload>;
    /** Remove a downloaded bundle. */
    removeDownload: (paperId: string) => Promise<void>;
    /** Queue a captured activity record for sync (Req 21.3). */
    enqueueRecord: (record: LocalSyncRecord) => Promise<void>;
    /** Flush the outbox now (Req 21.4). Returns the pass summary. */
    syncNow: () => Promise<SyncRunResult>;
    /** Re-probe connectivity immediately. */
    refreshConnectivity: () => Promise<ConnectivityStatus>;
}

const OfflineContext = createContext<OfflineContextValue | undefined>(undefined);

interface OfflineProviderProps {
    children: ReactNode;
    /** Inject a monitor (tests / a future NetInfo-backed one); defaults to the probe monitor. */
    monitor?: ConnectivityMonitor;
}

export function OfflineProvider({ children, monitor }: OfflineProviderProps): React.JSX.Element {
    // A single monitor instance for the provider's lifetime.
    const monitorRef = useRef<ConnectivityMonitor>(monitor ?? new ProbeConnectivityMonitor());

    const [status, setStatus] = useState<ConnectivityStatus>(() => monitorRef.current.getStatus());
    const [downloads, setDownloads] = useState<StoredOfflineDownload[]>([]);
    const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
    const [busy, setBusy] = useState(false);

    const mounted = useRef(true);
    // Guard against overlapping sync passes (e.g. a reconnect during a manual sync).
    const syncing = useRef(false);

    // Load the persisted store once on mount.
    const refreshLocalState = useCallback(async () => {
        const [nextDownloads, nextOutbox] = await Promise.all([
            store.listDownloads(),
            store.listOutbox(),
        ]);
        if (!mounted.current) return;
        setDownloads(nextDownloads);
        setOutbox(nextOutbox);
    }, []);

    /** Flush the outbox and refresh local state from it. Single-flighted. */
    const syncNow = useCallback(async (): Promise<SyncRunResult> => {
        if (syncing.current) {
            return { attempted: 0, synced: 0, remaining: outbox.length, results: [] };
        }
        syncing.current = true;
        if (mounted.current) setBusy(true);
        try {
            const result = await runSync();
            const nextOutbox = await store.listOutbox();
            if (mounted.current) setOutbox(nextOutbox);
            return result;
        } finally {
            syncing.current = false;
            if (mounted.current) setBusy(false);
        }
    }, [outbox.length]);

    // Startup: load store, then start the connectivity monitor and react to changes.
    useEffect(() => {
        mounted.current = true;
        const monitorInstance = monitorRef.current;
        void refreshLocalState();

        // Mirror monitor status into React state; the offline→online transition (and the
        // resulting sync-on-reconnect, Req 21.4) is handled by the status effect below.
        const unsubscribe = monitorInstance.subscribe((next) => {
            if (!mounted.current) return;
            setStatus(next);
        });

        monitorInstance.start();
        return () => {
            mounted.current = false;
            unsubscribe();
            monitorInstance.stop();
        };
    }, [refreshLocalState]);

    // Sync-on-reconnect: whenever status becomes 'online', attempt a flush. Running this from a
    // status effect (rather than inside the subscribe callback) keeps the transition logic in
    // one place and avoids races with the initial probe.
    const prevStatus = useRef<ConnectivityStatus>('unknown');
    useEffect(() => {
        const was = prevStatus.current;
        prevStatus.current = status;
        if (status === 'online' && was !== 'online') {
            void syncNow();
        }
    }, [status, syncNow]);

    const downloadPaper = useCallback(
        async (paperId: string): Promise<StoredOfflineDownload> => {
            if (mounted.current) setBusy(true);
            try {
                const bundle = await fetchPaperBundle(paperId);
                const saved = await store.saveDownload(bundle);
                const nextDownloads = await store.listDownloads();
                if (mounted.current) setDownloads(nextDownloads);
                return saved;
            } finally {
                if (mounted.current) setBusy(false);
            }
        },
        [],
    );

    const removeDownload = useCallback(async (paperId: string): Promise<void> => {
        await store.deleteDownload(paperId);
        const nextDownloads = await store.listDownloads();
        if (mounted.current) setDownloads(nextDownloads);
    }, []);

    const enqueueRecord = useCallback(async (record: LocalSyncRecord): Promise<void> => {
        const nextOutbox = await store.enqueue(record);
        if (mounted.current) setOutbox(nextOutbox);
    }, []);

    const refreshConnectivity = useCallback((): Promise<ConnectivityStatus> => {
        return monitorRef.current.refresh();
    }, []);

    const isFeatureUnavailable = useCallback(
        (feature: OfflineUnavailableFeature): boolean =>
            status === 'offline' && OFFLINE_UNAVAILABLE_FEATURES.includes(feature),
        [status],
    );

    const value = useMemo<OfflineContextValue>(
        () => ({
            status,
            isOffline: status === 'offline',
            downloads,
            outbox,
            busy,
            unavailableFeatures: OFFLINE_UNAVAILABLE_FEATURES,
            isFeatureUnavailable,
            downloadPaper,
            removeDownload,
            enqueueRecord,
            syncNow,
            refreshConnectivity,
        }),
        [
            status,
            downloads,
            outbox,
            busy,
            isFeatureUnavailable,
            downloadPaper,
            removeDownload,
            enqueueRecord,
            syncNow,
            refreshConnectivity,
        ],
    );

    return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

/** Access the offline context. Throws if used outside an {@link OfflineProvider}. */
export function useOffline(): OfflineContextValue {
    const ctx = useContext(OfflineContext);
    if (ctx === undefined) {
        throw new Error('useOffline must be used within an OfflineProvider');
    }
    return ctx;
}
