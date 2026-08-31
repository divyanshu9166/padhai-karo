import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { createSummary } from '@/screens/ai/api';

interface PendingPhoto { id: string; uri: string; mimeType: string; name: string; queuedAt: string; }
const KEY = 'offline:pending-photo-notes';
const DIRECTORY = (FileSystem.documentDirectory ?? '') + 'padhaikaro-offline/photos/';

async function read(): Promise<PendingPhoto[]> {
    try { const raw = await AsyncStorage.getItem(KEY); const value = raw ? JSON.parse(raw) : []; return Array.isArray(value) ? value as PendingPhoto[] : []; } catch { return []; }
}
async function write(value: PendingPhoto[]): Promise<void> { await AsyncStorage.setItem(KEY, JSON.stringify(value)); }

export async function queuePhotoNote(uri: string, mimeType = 'image/jpeg', name = 'Photo note.jpg'): Promise<void> {
    const current = await read();
    if (current.some((item) => item.uri === uri)) return;
    let durableUri = uri;
    if (FileSystem.documentDirectory && !uri.startsWith(FileSystem.documentDirectory)) {
        await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true }).catch(() => undefined);
        durableUri = DIRECTORY + `${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await FileSystem.copyAsync({ from: uri, to: durableUri });
    }
    await write([{ id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, uri: durableUri, mimeType, name, queuedAt: new Date().toISOString() }, ...current]);
}

export async function flushPendingPhotoNotes(): Promise<number> {
    const pending = await read(); let completed = 0; const remaining: PendingPhoto[] = [];
    for (const item of pending) {
        try {
            const base64 = await FileSystem.readAsStringAsync(item.uri, { encoding: FileSystem.EncodingType.Base64 });
            await createSummary({ inputType: 'PHOTO', imageData: `data:${item.mimeType};base64,${base64}`, mimeType: item.mimeType });
            await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined);
            completed += 1;
        } catch { remaining.push(item); }
    }
    await write(remaining);
    return completed;
}
