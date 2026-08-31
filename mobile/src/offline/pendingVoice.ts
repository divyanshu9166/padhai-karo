import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { transcribeVoiceNote, uploadVoiceNote } from '@/api/upscProduct';

interface PendingVoice { id: string; uri: string; name: string; queuedAt: string; remoteNoteId?: string; }
const KEY = 'offline:pending-voice-notes';
const DIRECTORY = (FileSystem.documentDirectory ?? '') + 'padhaikaro-offline/voice/';
async function read(): Promise<PendingVoice[]> { try { const raw = await AsyncStorage.getItem(KEY); const parsed = raw ? JSON.parse(raw) : []; return Array.isArray(parsed) ? parsed as PendingVoice[] : []; } catch { return []; } }
async function write(value: PendingVoice[]): Promise<void> { await AsyncStorage.setItem(KEY, JSON.stringify(value)); }
export async function queueVoiceNote(uri: string, name = 'Voice note'): Promise<void> {
    const pending = await read(); if (pending.some((item) => item.uri === uri)) return;
    let durableUri = uri;
    if (FileSystem.documentDirectory && !uri.startsWith(FileSystem.documentDirectory)) {
        await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true }).catch(() => undefined);
        durableUri = DIRECTORY + `${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}.m4a`;
        await FileSystem.copyAsync({ from: uri, to: durableUri });
    }
    await write([{ id: `voice-${Date.now()}`, uri: durableUri, name, queuedAt: new Date().toISOString() }, ...pending]);
}
export async function flushPendingVoiceNotes(): Promise<number> {
    const pending = await read(); let uploaded = 0; const remaining: PendingVoice[] = [];
    for (const item of pending) {
        let remoteNoteId = item.remoteNoteId;
        try {
            if (!remoteNoteId) {
                const result = await uploadVoiceNote(item.uri, item.name, undefined, ['offline-upload']);
                remoteNoteId = result.note.id;
                // The upload is durable even when transcription is not configured. Do
                // not retry it and create duplicate notes on every reconnect.
                if (!result.transcriptionAvailable) {
                    await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined);
                    uploaded += 1;
                    continue;
                }
            }
            await transcribeVoiceNote(remoteNoteId);
            await FileSystem.deleteAsync(item.uri, { idempotent: true }).catch(() => undefined);
            uploaded += 1;
        } catch { remaining.push({ ...item, ...(remoteNoteId ? { remoteNoteId } : {}) }); }
    }
    await write(remaining); return uploaded;
}
