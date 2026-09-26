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
import * as FileSystem from 'expo-file-system/legacy';

import { fetchOfflineWorkspace, fetchPaperBundle, type LocalSyncRecord, type OfflineWorkspaceBundle, type OfflineWorkspaceCursors, type OfflineWorkspacePage } from '@/api';
import { getAuthToken } from '@/api';
import { API_BASE_URL } from '@/config/env';
import {
    ProbeConnectivityMonitor,
    type ConnectivityMonitor,
    type ConnectivityStatus,
} from './connectivity';
import { runSync, type SyncRunResult } from './sync';
import * as store from './storage';
import type { OutboxEntry, StoredOfflineDownload } from './types';
import { flushPendingPdfUploads } from './pendingMedia';
import { flushPendingVoiceNotes } from './pendingVoice';
import { flushPendingPhotoNotes } from './pendingPhoto';
import { flushQueuedMutations, listOfflineConflicts, resolveOfflineConflict, type OfflineConflict } from './mutations';
import { cacheJson, clearCachedJson, readCachedJson } from './cache';

const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');
function absoluteApiUrl(value: string): string { return value.startsWith('/') ? API_ORIGIN + value : value; }
function safeFileName(value: string): string { return value.replace(/[^a-zA-Z0-9._-]/g, '_'); }
function authHeaders(): Record<string, string> { const token = getAuthToken(); return token ? { Authorization: `Bearer ${token}` } : {}; }
function headersForUrl(value: string): Record<string, string> { return value.startsWith('/') ? authHeaders() : {}; }

export interface OfflineDownloadProgress {
    phase: 'metadata' | 'media' | 'complete' | 'cancelled';
    current: number;
    total: number;
    errors: number;
}

interface DownloadMediaOptions {
    signal: AbortSignal;
    isCurrent: () => boolean;
    onProgress: (progress: OfflineDownloadProgress) => void;
    resumeStates: Record<string, { urlFingerprint: string; fileUri: string; resumeData: string }>;
    saveResumeStates: () => Promise<void>;
}

function fingerprintMediaUrl(value: string): string {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${value.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}

async function downloadResumableMedia(
    key: string,
    url: string,
    fileUri: string,
    headers: Record<string, string>,
    options: DownloadMediaOptions,
): Promise<Awaited<ReturnType<typeof FileSystem.downloadAsync>> | null> {
    const previous = options.resumeStates[key];
    const urlFingerprint = fingerprintMediaUrl(url);
    const canResume = Boolean(previous && previous.urlFingerprint === urlFingerprint && previous.fileUri === fileUri);
    if (!canResume) {
        if (previous) {
            delete options.resumeStates[key];
            await options.saveResumeStates();
        }
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
    }
    const task = FileSystem.createDownloadResumable(url, fileUri, { headers, md5: true }, undefined, canResume ? previous?.resumeData : undefined);
    let pausePromise: Promise<void> | null = null;
    const pauseForResume = (): void => {
        if (pausePromise) return;
        pausePromise = task.pauseAsync().then(async (state) => {
            if (state.resumeData) options.resumeStates[key] = { urlFingerprint, fileUri, resumeData: state.resumeData };
            else delete options.resumeStates[key];
            await options.saveResumeStates();
        }).catch(async () => {
            await task.cancelAsync().catch(() => undefined);
            delete options.resumeStates[key];
            await options.saveResumeStates();
        });
    };
    const onAbort = (): void => pauseForResume();
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
    try {
        let result: Awaited<ReturnType<typeof FileSystem.downloadAsync>> | undefined;
        try { result = await task.downloadAsync(); }
        catch (error) {
            if (options.signal.aborted) { await pausePromise; return null; }
            if (canResume) {
                delete options.resumeStates[key];
                await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
                await options.saveResumeStates();
            }
            throw error;
        }
        if (!result && options.signal.aborted) { await pausePromise; return null; }
        if (!result) throw new Error('The media download ended without a result.');
        if (!(await fileExists(result.uri))) {
            if (options.signal.aborted) return null;
            throw new Error('The downloaded media file is missing or empty.');
        }
        if (options.resumeStates[key]) {
            delete options.resumeStates[key];
            await options.saveResumeStates();
        }
        return result;
    } catch (error) {
        if (options.signal.aborted) { await pausePromise; return null; }
        throw error;
    } finally {
        options.signal.removeEventListener('abort', onAbort);
    }
}

async function fileExists(uri: string): Promise<boolean> {
    try {
        const info = await FileSystem.getInfoAsync(uri);
        return info.exists && (!('size' in info) || typeof info.size !== 'number' || info.size > 0);
    } catch { return false; }
}

/** Download all binary workspace assets and rendered PDF pages into durable app storage.
 *
 * Files are written to deterministic paths and skipped when already present, so a cancelled
 * or interrupted download resumes instead of starting over. Individual media failures are
 * recorded and do not abort the rest of the workspace.
 */
async function downloadWorkspaceMedia(bundle: OfflineWorkspaceBundle, options: DownloadMediaOptions): Promise<OfflineWorkspaceBundle> {
    if (!FileSystem.documentDirectory) return bundle;
    const root = FileSystem.documentDirectory + 'padhaikaro-offline/workspace/';
    const pdfDirectory = root + 'pdf/';
    const pageDirectory = root + 'pdf-pages/';
    const voiceDirectory = root + 'voice/';
    await Promise.all([
        FileSystem.makeDirectoryAsync(pdfDirectory, { intermediates: true }).catch(() => undefined),
        FileSystem.makeDirectoryAsync(pageDirectory, { intermediates: true }).catch(() => undefined),
        FileSystem.makeDirectoryAsync(voiceDirectory, { intermediates: true }).catch(() => undefined),
    ]);
    const cachedMedia = (await readCachedJson<Record<string, string>>('workspace-media'))?.value ?? {};
    const cachedChecksums = (await readCachedJson<Record<string, string>>('workspace-media-checksums'))?.value ?? {};
    const savedResumeStates = (await readCachedJson<Record<string, { urlFingerprint: string; fileUri: string; resumeData: string }>>('workspace-media-resume'))?.value ?? {};
    Object.assign(options.resumeStates, savedResumeStates);
    const media: Record<string, string> = { ...cachedMedia };
    const checksums: Record<string, string> = { ...cachedChecksums };
    const total = bundle.pdfs.reduce((sum, item) => sum + 1 + (typeof item.pageCount === 'number' ? Math.max(0, Math.floor(item.pageCount)) : 0), 0) + (bundle.voiceNotes ?? []).length;
    let current = 0;
    let errors = 0;
    const report = (phase: OfflineDownloadProgress['phase']): void => options.onProgress({ phase, current, total, errors });
    const pdfs: Array<Record<string, unknown>> = bundle.pdfs.slice();
    for (const [pdfIndex, raw] of bundle.pdfs.entries()) {
        if (options.signal.aborted) break;
        const item = raw as Record<string, unknown>;
        const id = typeof item.id === 'string' ? item.id : '';
        const fileUrl = typeof item.fileUrl === 'string' ? item.fileUrl : '';
        const pageCount = typeof item.pageCount === 'number' ? Math.max(0, Math.floor(item.pageCount)) : 0;
        let localUri: string | undefined;
        if (id && fileUrl) {
            const fileName = safeFileName(typeof item.fileName === 'string' ? item.fileName : `${id}.pdf`);
            const target = pdfDirectory + `${id}-${fileName}`;
            const key = `pdf:${id}`;
            const remoteChecksum = typeof item.fileChecksum === 'string' ? item.fileChecksum : '';
            try {
                const checksumChanged = Boolean(remoteChecksum && checksums[key] && checksums[key] !== remoteChecksum);
                if (checksumChanged) {
                    // A PDF replacement invalidates every previously rendered page for the
                    // same document id. Without this cleanup, stale PNGs survived a checksum
                    // change and the offline reader showed old pages beside the new PDF.
                    const pagePrefix = `pdf-page:${id}:`;
                    const stalePageEntries = Object.entries(media).filter(([mediaKey]) => mediaKey.startsWith(pagePrefix));
                    await Promise.all(stalePageEntries.map(([, uri]) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)));
                    stalePageEntries.forEach(([mediaKey]) => { delete media[mediaKey]; });
                }
                if (await fileExists(target) && !checksumChanged) localUri = target;
                else {
                    if (options.signal.aborted) break;
                    const result = await downloadResumableMedia(key, absoluteApiUrl(fileUrl), target + '.part', headersForUrl(fileUrl), options);
                    if (!result && options.signal.aborted) break;
                    if (!result) throw new Error('PDF download returned no result.');
                    if (result.status >= 400) throw new Error(`PDF download returned ${result.status}`);
                    if (checksumChanged) await FileSystem.deleteAsync(target, { idempotent: true });
                    await FileSystem.moveAsync({ from: result.uri, to: target });
                    localUri = target;
                }
                media[key] = localUri;
                if (remoteChecksum) checksums[key] = remoteChecksum;
            } catch { errors += 1; }
        }
        current += 1;
        report('media');
        const pageImageUris: Record<string, string> = {};
        if (id && pageCount > 0) {
            for (let page = 1; page <= pageCount; page += 1) {
                if (options.signal.aborted) break;
                try {
                    const target = pageDirectory + `${id}-${page}.png`;
                    const key = `pdf-page:${id}:${page}`;
                    if (await fileExists(target)) pageImageUris[String(page)] = target;
                    else {
                        const result = await downloadResumableMedia(key, absoluteApiUrl(`/api/pdf-documents/${encodeURIComponent(id)}/pages/${page}?scale=1.5`), target + '.part', authHeaders(), options);
                        if (!result && options.signal.aborted) break;
                        if (!result) throw new Error('PDF page download returned no result.');
                        if (result.status >= 400) throw new Error(`PDF page returned ${result.status}`);
                        await FileSystem.moveAsync({ from: result.uri, to: target });
                        pageImageUris[String(page)] = target;
                    }
                    media[key] = pageImageUris[String(page)];
                } catch { if (!options.signal.aborted) errors += 1; }
                current += 1;
                report('media');
            }
        }
        pdfs[pdfIndex] = { ...item, ...(localUri ? { localUri } : {}), ...(Object.keys(pageImageUris).length > 0 ? { pageImageUris } : {}) };
    }
    const voiceNotes: Array<Record<string, unknown>> = (bundle.voiceNotes ?? []).slice();
    for (const [voiceIndex, raw] of (bundle.voiceNotes ?? []).entries()) {
        if (options.signal.aborted) break;
        const item = raw as Record<string, unknown>;
        const id = typeof item.id === 'string' ? item.id : '';
        const audioUri = typeof item.audioUri === 'string' ? item.audioUri : '';
        let localUri: string | undefined;
        if (id && audioUri && !options.signal.aborted) {
            try {
                const fileName = safeFileName(typeof item.audioFileName === 'string' ? item.audioFileName : `${id}.m4a`);
                const target = voiceDirectory + `${id}-${fileName}`;
                if (await fileExists(target)) localUri = target;
                else {
                    const key = `voice:${id}`;
                    const result = await downloadResumableMedia(key, absoluteApiUrl(audioUri), target + '.part', headersForUrl(audioUri), options);
                    if (!result && options.signal.aborted) break;
                    if (!result) throw new Error('Voice note download returned no result.');
                    if (result.status >= 400) throw new Error(`Voice note returned ${result.status}`);
                    await FileSystem.moveAsync({ from: result.uri, to: target });
                    localUri = target;
                }
                media[`voice:${id}`] = localUri;
            } catch { if (!options.signal.aborted) errors += 1; }
        }
        current += 1;
        report('media');
        voiceNotes[voiceIndex] = { ...item, ...(localUri ? { localUri } : {}) };
    }
    if (options.isCurrent()) {
        await cacheJson('workspace-media', media);
        if (options.isCurrent()) await cacheJson('workspace-media-checksums', checksums);
    }
    return { ...bundle, pdfs, voiceNotes };
}

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
    conflicts: OfflineConflict[];
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
    resolveConflict: (clientId: string, resolution: 'SERVER' | 'LOCAL') => Promise<void>;
    /** Re-probe connectivity immediately. */
    refreshConnectivity: () => Promise<ConnectivityStatus>;
    /** Cached structured timetable/resources/PDF-text workspace for offline use. */
    workspace: OfflineWorkspaceBundle | null;
    downloadProgress: OfflineDownloadProgress | null;
    cancelDownload: () => void;
    /** Refresh the complete structured workspace cache. Supports pagination, resume and cancellation. */
    downloadWorkspace: () => Promise<OfflineWorkspaceBundle>;
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
    const [conflicts, setConflicts] = useState<OfflineConflict[]>([]);
    const [busy, setBusy] = useState(false);
    const [workspace, setWorkspace] = useState<OfflineWorkspaceBundle | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<OfflineDownloadProgress | null>(null);

    const mounted = useRef(true);
    // Guard against overlapping sync passes (e.g. a reconnect during a manual sync).
    const syncing = useRef(false);
    const workspaceDownload = useRef<AbortController | null>(null);
    const workspaceDownloadRun = useRef<Promise<OfflineWorkspaceBundle> | null>(null);

    // Load the persisted store once on mount.
    const refreshLocalState = useCallback(async () => {
        const [nextDownloads, nextOutbox, nextConflicts, cachedWorkspace] = await Promise.all([
            store.listDownloads(),
            store.listOutbox(),
            listOfflineConflicts(),
            readCachedJson<OfflineWorkspaceBundle>('workspace-bundle'),
        ]);
        if (!mounted.current) return;
        setDownloads(nextDownloads);
        setOutbox(nextOutbox);
        setConflicts(nextConflicts);
        setWorkspace(cachedWorkspace?.value ?? null);
    }, []);

    /** Flush the outbox and refresh local state from it. Single-flighted. */
    const syncNow = useCallback(async (): Promise<SyncRunResult> => {
        if (syncing.current) {
            return { attempted: 0, synced: 0, remaining: outbox.length, results: [] };
        }
        syncing.current = true;
        if (mounted.current) setBusy(true);
        try {
            await flushPendingPdfUploads().catch(() => []);
            await flushPendingVoiceNotes().catch(() => 0);
            await flushPendingPhotoNotes().catch(() => 0);
            await flushQueuedMutations().catch(() => 0);
            const result = await runSync();
            const nextOutbox = await store.listOutbox();
            const nextConflicts = await listOfflineConflicts();
            if (mounted.current) setOutbox(nextOutbox);
            if (mounted.current) setConflicts(nextConflicts);
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

    const cancelDownload = useCallback((): void => {
        workspaceDownload.current?.abort();
        setDownloadProgress((previous) => previous ? { ...previous, phase: 'cancelled' } : previous);
    }, []);

    const downloadWorkspace = useCallback((): Promise<OfflineWorkspaceBundle> => {
        if (workspaceDownloadRun.current) return workspaceDownloadRun.current;
        const operation = (async (): Promise<OfflineWorkspaceBundle> => {
            const controller = new AbortController();
            workspaceDownload.current = controller;
            if (mounted.current) setBusy(true);
            try {
            const checkpoint = await readCachedJson<{ bundle: OfflineWorkspaceBundle; cursors: OfflineWorkspaceCursors }>('workspace-download-checkpoint');
            let bundle: OfflineWorkspaceBundle = checkpoint?.value.bundle ?? { generatedAt: new Date().toISOString(), range: { from: new Date().toISOString(), to: new Date().toISOString() }, blocks: [], resources: [], pdfs: [], annotations: [], voiceNotes: [], events: [], sleepSchedule: null };
            let cursors: OfflineWorkspaceCursors = checkpoint?.value.cursors ?? {};
            const visitedCursorStates = new Set<string>();
            const addUnique = (existing: Array<Record<string, unknown>>, incoming: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
                const seen = new Set(existing.map((item) => typeof item.id === 'string' ? item.id : JSON.stringify(item)));
                return [...existing, ...incoming.filter((item) => { const key = typeof item.id === 'string' ? item.id : JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true; })];
            };
            let metadataDone = false;
            while (!metadataDone && !controller.signal.aborted) {
                const cursorState = JSON.stringify(cursors);
                if (visitedCursorStates.has(cursorState)) throw new Error('Offline sync stopped because the server repeated a pagination cursor. Retry after reconnecting.');
                visitedCursorStates.add(cursorState);
                if (workspaceDownload.current === controller) setDownloadProgress({ phase: 'metadata', current: 0, total: 0, errors: 0 });
                let page: OfflineWorkspacePage;
                try { page = await fetchOfflineWorkspace({ cursors, limit: 100, signal: controller.signal }); }
                catch (error) { if (controller.signal.aborted) break; throw error; }
                bundle = {
                    ...bundle,
                    generatedAt: page.generatedAt,
                    range: page.range,
                    blocks: addUnique(bundle.blocks, page.blocks),
                    resources: addUnique(bundle.resources, page.resources),
                    pdfs: addUnique(bundle.pdfs, page.pdfs),
                    annotations: addUnique(bundle.annotations, page.annotations),
                    voiceNotes: addUnique(bundle.voiceNotes, page.voiceNotes),
                    events: addUnique(bundle.events, page.events),
                    sleepSchedule: page.sleepSchedule,
                };
                const nextCursors = Object.fromEntries(Object.entries(page.nextCursors ?? {}).filter(([, value]) => value)) as OfflineWorkspaceCursors;
                metadataDone = Object.keys(nextCursors).length === 0;
                if (!metadataDone && JSON.stringify(nextCursors) === cursorState) throw new Error('Offline sync stopped because the server did not advance its pagination cursor. Retry after reconnecting.');
                cursors = nextCursors;
                await cacheJson('workspace-download-checkpoint', { bundle, cursors });
            }
            if (controller.signal.aborted && workspaceDownload.current !== controller) return bundle;
            if (controller.signal.aborted) {
                await cacheJson('workspace-bundle', bundle);
                if (mounted.current) setWorkspace(bundle);
                return bundle;
            }
            const mediaResumeStates: DownloadMediaOptions['resumeStates'] = {};
            const hydrated = await downloadWorkspaceMedia(bundle, {
                signal: controller.signal,
                isCurrent: () => workspaceDownload.current === controller,
                onProgress: (progress) => { if (workspaceDownload.current === controller) setDownloadProgress(progress); },
                resumeStates: mediaResumeStates,
                saveResumeStates: () => cacheJson('workspace-media-resume', mediaResumeStates),
            });
            if (controller.signal.aborted && workspaceDownload.current !== controller) return bundle;
            await cacheJson('workspace-bundle', hydrated);
            if (controller.signal.aborted) {
                if (workspaceDownload.current === controller) setDownloadProgress((previous) => previous ? { ...previous, phase: 'cancelled' } : { phase: 'cancelled', current: 0, total: 0, errors: 0 });
                if (mounted.current) setWorkspace(hydrated);
                return hydrated;
            }
            await clearCachedJson('workspace-download-checkpoint');
            if (mounted.current) setWorkspace(hydrated);
            if (workspaceDownload.current === controller) setDownloadProgress((previous) => previous ? { ...previous, phase: 'complete' } : { phase: 'complete', current: 0, total: 0, errors: 0 });
            return hydrated;
            } finally {
                if (workspaceDownload.current === controller) {
                    workspaceDownload.current = null;
                    if (mounted.current) setBusy(false);
                }
            }
        })();
        workspaceDownloadRun.current = operation;
        void operation.then(
            () => { if (workspaceDownloadRun.current === operation) workspaceDownloadRun.current = null; },
            () => { if (workspaceDownloadRun.current === operation) workspaceDownloadRun.current = null; },
        );
        return operation;
    }, []);

    const resolveConflict = useCallback(async (clientId: string, resolution: 'SERVER' | 'LOCAL'): Promise<void> => {
        await resolveOfflineConflict(clientId, resolution);
        const next = await listOfflineConflicts();
        if (mounted.current) setConflicts(next);
        if (resolution === 'LOCAL') void syncNow();
    }, [syncNow]);

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
            conflicts,
            busy,
            unavailableFeatures: OFFLINE_UNAVAILABLE_FEATURES,
            isFeatureUnavailable,
            downloadPaper,
            removeDownload,
            enqueueRecord,
            syncNow,
            resolveConflict,
            refreshConnectivity,
            workspace,
            downloadProgress,
            cancelDownload,
            downloadWorkspace,
        }),
        [
            status,
            downloads,
            outbox,
            conflicts,
            busy,
            isFeatureUnavailable,
            downloadPaper,
            removeDownload,
            enqueueRecord,
            syncNow,
            resolveConflict,
            refreshConnectivity,
            workspace,
            downloadProgress,
            cancelDownload,
            downloadWorkspace,
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
