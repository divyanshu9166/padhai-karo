/**
 * AI notes summarizer screen (task 21.7; Req 8.1, 8.2, 9.1, 9.5).
 *
 * Summarizes note text (Req 8.1) or a photo (Req 8.2, via the documented upload placeholder)
 * through `POST /ai/summaries`, showing the remaining quota and prior summaries. On a free-tier
 * `402 UPGRADE_REQUIRED` it routes to the Paywall (Req 9.1/9.5); on `429 QUOTA_EXCEEDED` it
 * surfaces the quota message. All gating/quota accounting is authoritative on the server.
 *
 * Reconstructed during scaffold recovery; composes the surviving ai `api` module and the
 * intact `PaywallScreen` (reachable via the Notes stack).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import type { NotesStackScreenProps } from '@/navigation/types';
import { OfflineBanner, generateClientId, useOffline } from '@/offline';
import { cacheJson, readCachedJson } from '@/offline/cache';
import { queueVoiceNote } from '@/offline/pendingVoice';
import { queuePhotoNote } from '@/offline/pendingPhoto';
import { uploadVoiceNote } from '@/api/upscProduct';

import {
  createSummary,
  listSummaries,
  type NoteSummary,
} from './api';

export function AiNotesScreen({
  navigation,
}: NotesStackScreenProps<'AiNotes'>): React.JSX.Element {
  const t = useTranslation();
  // The AI summarizer requires connectivity; surface it as unavailable offline (Req 21.6).
  const { isFeatureUnavailable, isOffline, enqueueRecord } = useOffline();
  const aiUnavailable = isFeatureUnavailable('AI_NOTES_SUMMARIZER');

  const [text, setText] = useState('');
  const [summaries, setSummaries] = useState<NoteSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { summaries: list } = await listSummaries();
      setSummaries(list);
      await cacheJson('ai-note-summaries', list);
    } catch {
      const cached = await readCachedJson<NoteSummary[]>('ai-note-summaries');
      if (cached) setSummaries(cached.value);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Handle a failed `POST /ai/summaries`. The free-tier `402 UPGRADE_REQUIRED` routes to the
   * paywall (Req 9.1); `429 QUOTA_EXCEEDED` and `422 EMPTY_INPUT` surface the matching localized
   * message inline (reusing the existing `paywall.quotaExceeded` / `ai.emptyInputError` keys);
   * any other failure shows the server message or a generic fallback.
   */
  const handleSummaryError = (err: unknown, fallback: string): void => {
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'UPGRADE_REQUIRED':
          navigation.navigate('Paywall');
          return;
        case 'QUOTA_EXCEEDED':
          setError(t('paywall.quotaExceeded'));
          return;
        case 'EMPTY_INPUT':
          setError(t('ai.emptyInputError'));
          return;
        default:
          setError(err.message);
          return;
      }
    }
    setError(fallback);
  };

  const onSummarizeText = async (): Promise<void> => {
    if (text.trim().length === 0) {
      setError(t('ai.emptyInputError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isOffline) {
        const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?।])\s+/).map((item) => item.trim()).filter(Boolean).slice(0, 7);
        const keyPoints = (sentences.length > 0 ? sentences : [text.trim()]).map((item) => item.length > 220 ? `${item.slice(0, 217)}…` : item);
        const summary: NoteSummary = { id: 'offline-' + Date.now(), userId: 'offline', inputType: 'TEXT', summary: { title: 'Offline quick note', keyPoints, revisionCapsule: keyPoints.slice(0, 5), flashcards: keyPoints.slice(0, 5).map((point, index) => ({ question: `Recall point ${index + 1}`, answer: point })) }, createdAt: new Date().toISOString() };
        await enqueueRecord({ clientId: generateClientId(), type: 'NOTE_SUMMARY', payload: { inputType: 'TEXT', summary: summary.summary } });
        setSummaries((previous) => [summary, ...previous]);
        setText('');
        setError(null);
        return;
      }
      await createSummary({ inputType: 'TEXT', text });
      setText('');
      await refresh();
    } catch (err) {
      handleSummaryError(err, 'Could not summarize.');
    } finally {
      setBusy(false);
    }
  };

  const onSummarizePhoto = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Photo permission is required.');
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: false });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      if (isOffline) {
        await queuePhotoNote(asset.uri, asset.mimeType || 'image/jpeg', asset.fileName || 'Photo note.jpg');
        setError('Photo note saved on this device. It will be processed when you reconnect.');
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await createSummary({ inputType: 'PHOTO', imageData: 'data:' + (asset.mimeType || 'image/jpeg') + ';base64,' + base64, mimeType: asset.mimeType || 'image/jpeg' });
      await refresh();
    } catch (err) {
      handleSummaryError(err, 'Could not summarize the photo.');
    } finally {
      setBusy(false);
    }
  };

  const onCapturePhoto = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Camera permission is required.');
      const captured = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: false });
      if (captured.canceled || !captured.assets[0]) return;
      const asset = captured.assets[0];
      if (isOffline) {
        await queuePhotoNote(asset.uri, asset.mimeType || 'image/jpeg', asset.fileName || 'Camera note.jpg');
        setError('Photo note saved on this device. It will be processed when you reconnect.');
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      await createSummary({ inputType: 'PHOTO', imageData: 'data:' + (asset.mimeType || 'image/jpeg') + ';base64,' + base64, mimeType: asset.mimeType || 'image/jpeg' });
      await refresh();
    } catch (err) {
      handleSummaryError(err, 'Could not process the captured photo.');
    } finally {
      setBusy(false);
    }
  };

  const onVoiceNote = async (): Promise<void> => {
    setError(null);
    if (recording) {
      setBusy(true);
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        if (!uri) throw new Error('Recording file was not created.');
        if (isOffline) {
          await queueVoiceNote(uri);
          setError('Voice note saved on this device. It will be transcribed when you reconnect.');
          return;
        }
        const uploaded = await uploadVoiceNote(uri, 'Voice note.m4a', undefined, ['voice-note']);
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await createSummary({ inputType: 'VOICE', audioData: 'data:audio/mp4;base64,' + base64, mimeType: 'audio/mp4', audioUri: uploaded.note.audioUri ?? uri, voiceNoteId: uploaded.note.id });
        await refresh();
      } catch (err) {
        handleSummaryError(err, 'Could not transcribe the voice note.');
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission is required.');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(created.recording);
    } catch (err) {
      handleSummaryError(err, 'Could not start recording.');
    }
  };

  return (
    <Screen title={t('ai.title')}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <OfflineBanner note="Offline text notes use a quick local summary. Photo and voice processing need internet." />

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Paste notes to summarize…"
          multiline
          editable={!busy}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primary, (busy || aiUnavailable) && styles.disabled]}
          onPress={() => void onSummarizeText()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryText}>{t('ai.summarizeText')}</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.secondary, (busy || aiUnavailable) && styles.disabled]}
          onPress={() => void onSummarizePhoto()}
          disabled={busy}
        >
          <Text style={styles.secondaryText}>{t('ai.summarizePhoto')}</Text>
        </Pressable>

        <Pressable
          style={[styles.secondary, (busy || aiUnavailable) && styles.disabled]}
          onPress={() => void onCapturePhoto()}
          disabled={busy}
        >
          <Text style={styles.secondaryText}>Capture note with camera</Text>
        </Pressable>

        <Pressable
          style={[styles.secondary, (busy || (!recording && aiUnavailable)) && styles.disabled]}
          onPress={() => void onVoiceNote()}
          disabled={busy || (!recording && isOffline === false && aiUnavailable)}
        >
          <Text style={styles.secondaryText}>{recording ? 'Stop and transcribe recording' : 'Record voice note'}</Text>
        </Pressable>

        {summaries.map((summary) => (
          <View key={summary.id} style={styles.summaryCard}>
            <Text style={styles.summaryMeta}>{summary.inputType}</Text>
            {summary.summary.title ? (
              <Text style={styles.summaryTitle}>{summary.summary.title}</Text>
            ) : null}
            {summary.summary.keyPoints.map((point, i) => (
              <Text key={i} style={styles.point}>
                • {point}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  quota: { fontSize: 14, fontWeight: '600', color: '#15803d', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    minHeight: 120,
    textAlignVertical: 'top',
  },
  error: { color: '#dc2626', fontSize: 14, marginTop: 12 },
  primary: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  secondary: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryText: { color: '#2563eb', fontSize: 15, fontWeight: '600' },
  link: { alignItems: 'center', marginTop: 16 },
  linkText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
  summaryCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    backgroundColor: '#ffffff',
  },
  summaryMeta: { fontSize: 12, fontWeight: '600', color: '#6b7280', marginBottom: 4 },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 6 },
  point: { fontSize: 14, color: '#374151', marginTop: 2 },
  disabled: { opacity: 0.6 },
});
