import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { uploadPdfDocument, type PdfDocument } from '@/api/upscProduct';

export interface PendingPdfUpload { id: string; uri: string; name: string; tags: string[]; queuedAt: string; }
const KEY = 'offline:pending-pdf-uploads';
const DIRECTORY = (FileSystem.documentDirectory ?? '') + 'padhaikaro-offline/pdfs/';

async function read(): Promise<PendingPdfUpload[]> {
    try { const raw = await AsyncStorage.getItem(KEY); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed as PendingPdfUpload[] : []; } catch { return []; }
}
async function write(value: PendingPdfUpload[]): Promise<void> { await AsyncStorage.setItem(KEY, JSON.stringify(value)); }

async function makeDurableUri(uri: string, name: string): Promise<string> {
    if (!FileSystem.documentDirectory || uri.startsWith(FileSystem.documentDirectory)) return uri;
    await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true }).catch(() => undefined);
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destination = DIRECTORY + `${Date.now()}-${safe}`;
    await FileSystem.copyAsync({ from: uri, to: destination });
    return destination;
}

export async function queuePdfUpload(input: Omit<PendingPdfUpload, 'id' | 'queuedAt'>): Promise<PendingPdfUpload> {
    const current = await read();
    if (current.some((item) => item.uri === input.uri)) return current.find((item) => item.uri === input.uri) as PendingPdfUpload;
    const durableUri = await makeDurableUri(input.uri, input.name);
    const queued: PendingPdfUpload = { ...input, uri: durableUri, id: `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, queuedAt: new Date().toISOString() };
    // Keep the complete durable queue. The reconnect flusher uploads one item at a time,
    // so large offline libraries are resumable instead of silently dropping older files.
    await write([queued, ...current]);
    return queued;
}

export async function listPendingPdfUploads(): Promise<PendingPdfUpload[]> { return read(); }

export async function flushPendingPdfUploads(): Promise<PdfDocument[]> {
    const pending = await read();
    const uploaded: PdfDocument[] = [];
    const remaining: PendingPdfUpload[] = [];
    for (const item of pending) {
        try { uploaded.push((await uploadPdfDocument(item.uri, item.name, item.tags)).document); await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined); }
        catch { remaining.push(item); }
    }
    await write(remaining);
    return uploaded;
}
