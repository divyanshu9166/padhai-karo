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
import { OfflineBanner, useOffline } from '@/offline';

import {
  createSummary,
  getSubscription,
  listSummaries,
  pickAndUploadImagePlaceholder,
  type NoteSummary,
} from './api';

export function AiNotesScreen({
  navigation,
}: NotesStackScreenProps<'AiNotes'>): React.JSX.Element {
  const t = useTranslation();
  // The AI summarizer requires connectivity; surface it as unavailable offline (Req 21.6).
  const { isFeatureUnavailable } = useOffline();
  const aiUnavailable = isFeatureUnavailable('AI_NOTES_SUMMARIZER');

  const [text, setText] = useState('');
  const [summaries, setSummaries] = useState<NoteSummary[]>([]);
  const [remainingQuota, setRemainingQuota] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [{ summaries: list }, subscription] = await Promise.all([
        listSummaries(),
        getSubscription().catch(() => null),
      ]);
      setSummaries(list);
      if (subscription) {
        setRemainingQuota(subscription.aiQuota);
      }
    } catch {
      // Non-fatal: the compose box still works; surface errors on submit instead.
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
      const res = await createSummary({ inputType: 'TEXT', text });
      setRemainingQuota(res.remainingQuota);
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
      const imageUploadId = await pickAndUploadImagePlaceholder();
      const res = await createSummary({ inputType: 'PHOTO', imageUploadId });
      setRemainingQuota(res.remainingQuota);
      await refresh();
    } catch (err) {
      handleSummaryError(err, 'Could not summarize the photo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('ai.title')}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <OfflineBanner note="The AI notes summarizer is unavailable offline." />

        {remainingQuota !== null ? (
          <Text style={styles.quota}>
            {t('ai.remainingQuota')}: {remainingQuota}
          </Text>
        ) : null}

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Paste notes to summarize…"
          multiline
          editable={!busy && !aiUnavailable}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primary, (busy || aiUnavailable) && styles.disabled]}
          onPress={() => void onSummarizeText()}
          disabled={busy || aiUnavailable}
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
          disabled={busy || aiUnavailable}
        >
          <Text style={styles.secondaryText}>{t('ai.summarizePhoto')}</Text>
        </Pressable>

        <Pressable style={styles.link} onPress={() => navigation.navigate('Paywall')}>
          <Text style={styles.linkText}>{t('paywall.title')}</Text>
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
