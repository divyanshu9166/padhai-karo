import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from '@/api';

export interface OfflineMutation { clientId: string; type: string; payload: Record<string, unknown>; queuedAt: string; }
export interface OfflineConflict { clientId: string; type: string; payload: Record<string, unknown>; server: Record<string, unknown>; message: string; detectedAt: string; }
const KEY = 'offline:mutations';
const CONFLICT_KEY = 'offline:mutation-conflicts';

async function read(): Promise<OfflineMutation[]> { try { const raw = await AsyncStorage.getItem(KEY); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed as OfflineMutation[] : []; } catch { return []; } }
async function write(value: OfflineMutation[]): Promise<void> { await AsyncStorage.setItem(KEY, JSON.stringify(value)); }
async function readConflicts(): Promise<OfflineConflict[]> { try { const raw = await AsyncStorage.getItem(CONFLICT_KEY); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed as OfflineConflict[] : []; } catch { return []; } }
async function writeConflicts(value: OfflineConflict[]): Promise<void> { await AsyncStorage.setItem(CONFLICT_KEY, JSON.stringify(value)); }
function clientId(): string { return `mutation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }

export async function listQueuedMutations(): Promise<OfflineMutation[]> { return read(); }
export async function listOfflineConflicts(): Promise<OfflineConflict[]> { return readConflicts(); }
export async function queueMutation(type: string, payload: Record<string, unknown>): Promise<OfflineMutation> {
    const item: OfflineMutation = { clientId: clientId(), type, payload, queuedAt: new Date().toISOString() };
    // Keep the durable queue unbounded. The flusher batches requests at the server's
    // protocol limit, so offline edits are never silently discarded when a learner makes
    // more than 100 changes before reconnecting.
    await write([...(await read()), item]); return item;
}
export async function flushQueuedMutations(): Promise<number> {
    const pending = await read(); if (pending.length === 0) return 0;
    const acknowledged = new Set<string>();
    for (let offset = 0; offset < pending.length; offset += 100) {
        const batch = pending.slice(offset, offset + 100);
        const response = await request<{ results: Array<{ clientId: string; status: string; message?: string; conflict?: Record<string, unknown> }> }>('/sync/mutations', { method: 'POST', body: { records: batch.map(({ clientId, type, payload }) => ({ clientId, type, payload })) } });
        const conflictResults = response.results.filter((result) => result.status === 'CONFLICT');
        if (conflictResults.length > 0) {
            const existing = await readConflicts();
            const incoming = conflictResults.map((result) => {
                const mutation = batch.find((item) => item.clientId === result.clientId);
                return mutation ? { clientId: mutation.clientId, type: mutation.type, payload: mutation.payload, server: result.conflict ?? {}, message: result.message ?? 'Offline change conflicts with the server.', detectedAt: new Date().toISOString() } : null;
            }).filter((item): item is OfflineConflict => item !== null);
            await writeConflicts([...incoming, ...existing.filter((item) => !incoming.some((next) => next.clientId === item.clientId))]);
        }
        response.results.filter((result) => result.status === 'APPLIED' || result.status === 'DUPLICATE' || result.status === 'CONFLICT').forEach((result) => acknowledged.add(result.clientId));
    }
    await write(pending.filter((item) => !acknowledged.has(item.clientId)));
    return acknowledged.size;
}

/** Resolve a conflict: SERVER discards local edits; LOCAL retries them on top of the latest version. */
export async function resolveOfflineConflict(clientIdValue: string, resolution: 'SERVER' | 'LOCAL'): Promise<void> {
    const conflicts = await readConflicts();
    const conflict = conflicts.find((item) => item.clientId === clientIdValue);
    if (!conflict) return;
    if (resolution === 'LOCAL') {
        const updatedAt = typeof conflict.server.updatedAt === 'string' ? conflict.server.updatedAt : undefined;
        await queueMutation(conflict.type, { ...conflict.payload, ...(updatedAt ? { baseUpdatedAt: updatedAt } : {}) });
    }
    await writeConflicts(conflicts.filter((item) => item.clientId !== clientIdValue));
}
