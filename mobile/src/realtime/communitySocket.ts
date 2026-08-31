import { getAuthToken } from '@/api';
import { COMMUNITY_WS_URL } from '@/config/env';
import type { CommunityMessage } from '@/api/upscProduct';

export type CommunityRealtimeEvent =
    | { type: 'ready'; userId: string }
    | { type: 'message'; message: CommunityMessage }
    | { type: 'error'; code: string; message: string }
    | { type: 'status'; status: 'connected' | 'disconnected' };

export class CommunitySocket {
    private socket: WebSocket | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private explicitlyClosed = false;
    private readonly listeners = new Set<(event: CommunityRealtimeEvent) => void>();

    subscribe(listener: (event: CommunityRealtimeEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    connect(): void {
        const token = getAuthToken();
        if (!token || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
        this.explicitlyClosed = false;
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        try {
            const socket = new WebSocket(`${COMMUNITY_WS_URL}?token=${encodeURIComponent(token)}`);
            this.socket = socket;
            socket.onopen = () => { this.reconnectAttempt = 0; this.emit({ type: 'status', status: 'connected' }); };
            socket.onmessage = (event) => {
                try { this.emit(JSON.parse(String(event.data)) as CommunityRealtimeEvent); }
                catch { /* malformed realtime frames are ignored; polling remains available */ }
            };
            socket.onclose = () => {
                this.socket = null;
                this.emit({ type: 'status', status: 'disconnected' });
                if (!this.explicitlyClosed && getAuthToken()) {
                    const delay = Math.min(30_000, 500 * (2 ** this.reconnectAttempt));
                    this.reconnectAttempt += 1;
                    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
                }
            };
            socket.onerror = () => { /* onclose emits the fallback status */ };
        } catch { this.emit({ type: 'status', status: 'disconnected' }); }
    }

    sendMessage(recipientId: string, body: string): boolean {
        if (this.socket?.readyState !== WebSocket.OPEN) return false;
        this.socket.send(JSON.stringify({ type: 'message', recipientId, body }));
        return true;
    }

    close(): void {
        this.explicitlyClosed = true;
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        this.socket?.close();
        this.socket = null;
    }

    private emit(event: CommunityRealtimeEvent): void { for (const listener of this.listeners) listener(event); }
}
