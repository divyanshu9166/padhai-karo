/** Offline mode barrel (task 21.9; Req 21). */
export { OfflineProvider, useOffline, OFFLINE_UNAVAILABLE_FEATURES } from './OfflineContext';
export type { OfflineUnavailableFeature } from './OfflineContext';
export { OfflineBanner } from './OfflineBanner';
export { scoreBundle } from './scoring';
export type { LocalAttemptResult, LocalPerQuestion, LocalOutcome } from './scoring';
export {
    ProbeConnectivityMonitor,
    defaultReachabilityProbe,
    type ConnectivityMonitor,
    type ConnectivityStatus,
    type ReachabilityProbe,
} from './connectivity';
export { runSync, runSyncWith, type SyncRunResult, type SyncDeps } from './sync';
export { generateClientId } from './clientId';
export {
    listDownloads,
    getDownload,
    saveDownload,
    deleteDownload,
    listOutbox,
    enqueue,
    removeFromOutbox,
    clearOutbox,
} from './storage';
export type { StoredOfflineDownload, OutboxEntry } from './types';
