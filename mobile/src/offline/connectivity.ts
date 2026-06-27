/**
 * Connectivity detection (task 21.9; Req 21.2, 21.4).
 *
 * CONNECTIVITY CHOICE — abstracted interface + probe default (documented decision):
 *   A dedicated connectivity library (`@react-native-community/netinfo` or `expo-network`) is
 *   NOT installed in this project and cannot be added/prebuilt in this environment. So instead
 *   of binding to one, this module defines a small {@link ConnectivityMonitor} interface and
 *   ships a dependency-free default that infers reachability by periodically *probing* the
 *   Backend_API. Swapping in NetInfo/expo-network later is a drop-in: implement the same
 *   interface (push events from the native module instead of polling) and inject it into the
 *   OfflineProvider — no caller changes.
 *
 * The monitor is intentionally tiny: a current status, a subscribe/notify mechanism, and a
 * `refresh()` that re-probes on demand. Transitions are what drive sync-on-reconnect (the
 * provider listens for offline → online).
 */

import { API_BASE_URL } from '@/api';

/** Reachability of the Backend_API. `unknown` until the first probe resolves. */
export type ConnectivityStatus = 'online' | 'offline' | 'unknown';

/** A push/pull connectivity source. Implementations may poll or wrap a native module. */
export interface ConnectivityMonitor {
    /** The last known status (synchronous; `unknown` before the first probe). */
    getStatus(): ConnectivityStatus;
    /** Subscribe to status changes; returns an unsubscribe function. */
    subscribe(listener: (status: ConnectivityStatus) => void): () => void;
    /** Begin observing (e.g. start polling). Idempotent. */
    start(): void;
    /** Stop observing and release resources. Idempotent. */
    stop(): void;
    /** Force a re-evaluation now; resolves with the freshly determined status. */
    refresh(): Promise<ConnectivityStatus>;
}

/** A probe returns `true` when the Backend_API is reachable, `false` otherwise. */
export type ReachabilityProbe = (signal: AbortSignal) => Promise<boolean>;

/**
 * Default probe: a short, cheap GET to the API health endpoint. Any network/timeout error is
 * treated as "offline". Kept out of the monitor class so it can be swapped/mocked in tests.
 */
export async function defaultReachabilityProbe(signal: AbortSignal): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE_URL}/health`, { method: 'GET', signal });
        return response.ok;
    } catch {
        return false;
    }
}

interface ProbeMonitorOptions {
    /** How often to re-probe while started, in ms. Default 15s. */
    intervalMs?: number;
    /** Per-probe timeout in ms. Default 5s. */
    timeoutMs?: number;
    /** The reachability probe; defaults to {@link defaultReachabilityProbe}. */
    probe?: ReachabilityProbe;
}

/**
 * Poll-based {@link ConnectivityMonitor}. Probes immediately on `start()`, then on an interval,
 * and notifies subscribers only when the status actually changes (so listeners aren't spammed
 * with identical "still online" events).
 */
export class ProbeConnectivityMonitor implements ConnectivityMonitor {
    private status: ConnectivityStatus = 'unknown';
    private readonly listeners = new Set<(status: ConnectivityStatus) => void>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private readonly intervalMs: number;
    private readonly timeoutMs: number;
    private readonly probe: ReachabilityProbe;

    constructor(options: ProbeMonitorOptions = {}) {
        this.intervalMs = options.intervalMs ?? 15_000;
        this.timeoutMs = options.timeoutMs ?? 5_000;
        this.probe = options.probe ?? defaultReachabilityProbe;
    }

    getStatus(): ConnectivityStatus {
        return this.status;
    }

    subscribe(listener: (status: ConnectivityStatus) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    start(): void {
        if (this.timer !== null) {
            return;
        }
        // Probe once immediately, then on the interval.
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async refresh(): Promise<ConnectivityStatus> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        let reachable: boolean;
        try {
            reachable = await this.probe(controller.signal);
        } catch {
            reachable = false;
        } finally {
            clearTimeout(timeout);
        }
        this.setStatus(reachable ? 'online' : 'offline');
        return this.status;
    }

    /** Update status and notify subscribers when it changes. */
    private setStatus(next: ConnectivityStatus): void {
        if (next === this.status) {
            return;
        }
        this.status = next;
        for (const listener of this.listeners) {
            listener(next);
        }
    }
}
