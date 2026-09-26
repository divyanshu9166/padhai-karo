/**
 * AI notes summarizer screen (task 21.7; Req 8.1, 8.2, 9.1, 9.5).
 *
 * Summarizes note text (Req 8.1) or a photo (Req 8.2, via the documented upload placeholder)
 * through `POST /ai/notes`, showing the remaining quota and prior summaries. On a free-tier
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
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { interpolate, useTranslation, type StringKey } from '@/localization';
import type { NotesStackScreenProps } from '@/navigation/types';
import { OfflineBanner, generateClientId, useOffline } from '@/offline';
import { cacheJson, readCachedJson } from '@/offline/cache';
import { queueVoiceNote } from '@/offline/pendingVoice';
import { queuePhotoNote } from '@/offline/pendingPhoto';
import { uploadVoiceNote } from '@/api/upscProduct';

import {
  createSummary,
  getSubscription,
  listSummaries,
  type AiAllowance,
  type NoteSummary,
} from './api';

/** A denied device permission, shown to the student as-is rather than as a generic failure. */
class PermissionDeniedError extends Error {
  constructor(readonly messageKey: StringKey) {
    super(messageKey);
  }
}

const INPUT_LABELS: Record<string, StringKey> = { TEXT: 'ai.inputText', PHOTO: 'ai.inputPhoto', VOICE: 'ai.inputVoice' };

export function AiNotesScreen({
  navigation,
}: NotesStackScreenProps<'AiNotes'>): React.JSX.Element {
  const t = useTranslation();
  // The AI summarizer requires connectivity; surface it as unavailable offline (Req 21.6).
  const { isFeatureUnavailable, isOffline, enqueueRecord } = useOffline();
  const aiUnavailable = isFeatureUnavailable('AI_NOTES_SUMMARIZER');

  const [text, setText] = useState('');
  const [summaries, setSummaries] = useState<NoteSummary[]>([]);
  const [allowance, setAllowance] = useState<AiAllowance | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [pendingVoice, setPendingVoice] = useState<{ id: string; title: string } | null>(null);
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
    void getSubscription().then((subscription) => setAllowance(subscription.aiAllowance ?? null)).catch(() => undefined);
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
    if (err instanceof PermissionDeniedError) {
      setError(t(err.messageKey));
      return;
    }
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
        const summary: NoteSummary = { id: 'offline-' + Date.now(), userId: 'offline', inputType: 'TEXT', summary: { title: t('ai.offlineQuickNote'), keyPoints, revisionCapsule: keyPoints.slice(0, 5), flashcards: keyPoints.slice(0, 5).map((point, index) => ({ question: interpolate(t('ai.recallPoint'), { n: index + 1 }), answer: point })), generationSource: 'LOCAL_OFFLINE' }, createdAt: new Date().toISOString() };
        await enqueueRecord({ clientId: generateClientId(), type: 'NOTE_SUMMARY', payload: { inputType: 'TEXT', summary: summary.summary } });
        setSummaries((previous) => [summary, ...previous]);
        setText('');
        setError(null);
        return;
      }
      const result = await createSummary({ inputType: 'TEXT', text });
      if (result.aiAllowance) setAllowance(result.aiAllowance);
      setText('');
      await refresh();
    } catch (err) {
      handleSummaryError(err, t('ai.summarizeError'));
    } finally {
      setBusy(false);
    }
  };

  const onSummarizePhoto = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new PermissionDeniedError('ai.photoPermission');
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: false });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      if (isOffline) {
        await queuePhotoNote(asset.uri, asset.mimeType || 'image/jpeg', asset.fileName || 'Photo note.jpg');
        setError(t('ai.photoQueued'));
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const result = await createSummary({ inputType: 'PHOTO', imageData: 'data:' + (asset.mimeType || 'image/jpeg') + ';base64,' + base64, mimeType: asset.mimeType || 'image/jpeg' });
      if (result.aiAllowance) setAllowance(result.aiAllowance);
      await refresh();
    } catch (err) {
      handleSummaryError(err, t('ai.photoError'));
    } finally {
      setBusy(false);
    }
  };

  const onCapturePhoto = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new PermissionDeniedError('ai.cameraPermission');
      const captured = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: false });
      if (captured.canceled || !captured.assets[0]) return;
      const asset = captured.assets[0];
      if (isOffline) {
        await queuePhotoNote(asset.uri, asset.mimeType || 'image/jpeg', asset.fileName || 'Camera note.jpg');
        setError(t('ai.photoQueued'));
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const result = await createSummary({ inputType: 'PHOTO', imageData: 'data:' + (asset.mimeType || 'image/jpeg') + ';base64,' + base64, mimeType: asset.mimeType || 'image/jpeg' });
      if (result.aiAllowance) setAllowance(result.aiAllowance);
      await refresh();
    } catch (err) {
      handleSummaryError(err, t('ai.cameraError'));
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
        if (!uri) throw new PermissionDeniedError('ai.recordingMissing');
        if (isOffline) {
          await queueVoiceNote(uri);
          setError(t('ai.voiceQueued'));
          return;
        }
        const uploaded = await uploadVoiceNote(uri, 'Voice note.m4a', undefined, ['voice-note']);
        setPendingVoice({ id: uploaded.note.id, title: uploaded.note.title || t('ai.voiceNoteTitle') });
        const result = await createSummary({ inputType: 'VOICE', voiceNoteId: uploaded.note.id });
        if (result.aiAllowance) setAllowance(result.aiAllowance);
        setPendingVoice(null);
        await refresh();
      } catch (err) {
        handleSummaryError(err, t('ai.voiceError'));
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) throw new PermissionDeniedError('ai.micPermission');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(created.recording);
    } catch (err) {
      handleSummaryError(err, t('ai.recordStartError'));
    }
  };

  const retryVoiceSummary = async (): Promise<void> => {
    if (!pendingVoice || busy || isOffline) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createSummary({ inputType: 'VOICE', voiceNoteId: pendingVoice.id, title: pendingVoice.title });
      if (result.aiAllowance) setAllowance(result.aiAllowance);
      setPendingVoice(null);
      await refresh();
    } catch (err) {
      handleSummaryError(err, t('ai.savedVoiceError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('ai.title')}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <OfflineBanner note={t('ai.offlineNote')} />
        {allowance ? (
          <Pressable onPress={() => navigation.navigate('Paywall')} accessibilityRole="button">
            <Text style={styles.quota}>
              {allowance.plan === 'PAID'
                ? interpolate(t('paywall.paidRemaining'), { remaining: allowance.remaining })
                : allowance.plan === 'TRIAL'
                  ? interpolate(t('paywall.trialActive'), { remaining: allowance.remaining, date: new Date(allowance.trialEndsAt).toLocaleDateString() })
                  : interpolate(t('paywall.freeRemaining'), { remaining: allowance.remaining, limit: allowance.limit })}
            </Text>
            {allowance.plan !== 'PAID' ? <Text style={styles.plansLink}>{t('ai.seePlans')}</Text> : null}
          </Pressable>
        ) : null}

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={t('ai.inputPlaceholder')}
          multiline
          editable={!busy}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {pendingVoice ? <Pressable style={[styles.secondary, busy && styles.disabled]} onPress={() => void retryVoiceSummary()} disabled={busy || isOffline}><Text style={styles.secondaryText}>{busy ? t('ai.processingVoice') : t('ai.retryVoice')}</Text></Pressable> : null}

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
          <Text style={styles.secondaryText}>{t('ai.captureCamera')}</Text>
        </Pressable>

        <Pressable
          style={[styles.secondary, (busy || (!recording && aiUnavailable)) && styles.disabled]}
          onPress={() => void onVoiceNote()}
          disabled={busy || (!recording && isOffline === false && aiUnavailable)}
        >
          <Text style={styles.secondaryText}>{recording ? t('ai.stopAndTranscribe') : t('ai.recordVoice')}</Text>
        </Pressable>

        {summaries.map((summary) => (
          <View key={summary.id} style={styles.summaryCard}>
            <View style={styles.summaryTop}><Text style={styles.summaryMeta}>{t(INPUT_LABELS[summary.inputType] ?? 'ai.inputText')} • {summary.summary.generationSource?.includes('LOCAL') ? t('ai.localSummary') : summary.summary.generationSource ? t('ai.aiGenerated') : t('ai.summaryLabel')} • {t('ai.saved')}</Text><Pressable onPress={() => void Share.share({ title: summary.summary.title ?? t('ai.studyNote'), message: `${summary.summary.title ?? t('ai.studyNote')}\n\n${summary.summary.keyPoints.map((point) => `• ${point}`).join('\n')}` })}><Text style={styles.export}>{t('ai.export')}</Text></Pressable></View>
            {summary.summary.title ? (
              <Text style={styles.summaryTitle}>{summary.summary.title}</Text>
            ) : null}
            <Text style={styles.capsuleLabel}>{t('ai.thirtySecondSummary')}</Text>
            {summary.summary.keyPoints.map((point, i) => (
              <Text key={i} style={styles.point}>
                • {point}
              </Text>
            ))}
            {summary.summary.revisionCapsule?.length ? <View style={styles.capsule}><Text style={styles.capsuleLabel}>{t('ai.revisionCapsule')}</Text>{summary.summary.revisionCapsule.slice(0, 5).map((point, index) => <Text key={`${index}-${point}`} style={styles.point}>{index + 1}. {point}</Text>)}</View> : null}
            {summary.summary.flashcards?.length ? <View style={styles.recallReady}><Text style={styles.summaryTitle}>{interpolate(t('ai.recallCardsReady'), { count: summary.summary.flashcards.length })}</Text><Text style={styles.point}>{t('ai.recallQueued')}</Text></View> : null}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  plansLink: { color: '#2563eb', fontWeight: '700', marginTop: -6, marginBottom: 12 },
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
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  export: { color: '#1d4ed8', fontWeight: '700', fontSize: 12 },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 6 },
  point: { fontSize: 14, color: '#374151', marginTop: 2 },
  capsuleLabel: { color: '#1d4ed8', fontSize: 12, fontWeight: '800', marginTop: 8, marginBottom: 4 },
  capsule: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 12, marginTop: 10 },
  recallReady: { backgroundColor: '#ecfdf5', borderRadius: 12, padding: 12, marginTop: 10 },
  disabled: { opacity: 0.6 },
});
