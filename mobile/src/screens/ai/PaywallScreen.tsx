/**
 * Subscription / paywall screen (task 21.7; Req 9.5).
 *
 * Shows where the student stands (free weekly AI notes, an active trial, or a paid balance),
 * offers the one-time 7-day free trial (`POST /subscriptions/trial`, no payment), and lists the
 * purchasable plans. Buying runs the order → checkout → verify flow:
 * `POST /subscriptions/order` → (native Razorpay checkout, stubbed) → `POST /subscriptions/verify`.
 * The checkout integration is a documented placeholder (see ai/api.ts).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { interpolate, useTranslation, type StringKey } from '@/localization';

import {
  SUBSCRIPTION_PLANS,
  createSubscriptionOrder,
  formatInrPaise,
  getSubscription,
  runRazorpayCheckoutPlaceholder,
  startFreeTrial,
  verifySubscription,
  type GetSubscriptionResponse,
  type SubscriptionPlanId,
} from './api';

const PLAN_LABELS: Record<SubscriptionPlanId, StringKey> = {
  monthly: 'paywall.planMonthly',
  quarterly: 'paywall.planQuarterly',
  annual: 'paywall.planAnnual',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function PaywallScreen(): React.JSX.Element {
  const t = useTranslation();

  const [subscription, setSubscription] = useState<GetSubscriptionResponse | null>(null);
  const [busyPlan, setBusyPlan] = useState<SubscriptionPlanId | 'trial' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setSubscription(await getSubscription());
    } catch {
      setError(t('paywall.loadError'));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const onStartTrial = async (): Promise<void> => {
    setBusyPlan('trial');
    setError(null);
    setResult(null);
    try {
      await startFreeTrial();
      setResult(t('paywall.trialStarted'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('paywall.trialError'));
    } finally {
      setBusyPlan(null);
    }
  };

  const onUpgrade = async (plan: SubscriptionPlanId): Promise<void> => {
    setBusyPlan(plan);
    setError(null);
    setResult(null);
    try {
      const order = await createSubscriptionOrder(plan);
      const checkout = await runRazorpayCheckoutPlaceholder(order.razorpayOrderId);
      const verified = await verifySubscription({
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: checkout.razorpayPaymentId,
        signature: checkout.signature,
      });
      setResult(interpolate(t('paywall.upgraded'), { count: verified.aiQuota }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'PAYMENT_FAILED' ? t('paywall.paymentFailed') : err instanceof ApiError ? err.message : t('paywall.paymentFailed'));
    } finally {
      setBusyPlan(null);
    }
  };

  const allowance = subscription?.aiAllowance;
  let status: string | null = null;
  if (allowance?.plan === 'PAID') status = interpolate(t('paywall.paidRemaining'), { remaining: allowance.remaining });
  else if (allowance?.plan === 'TRIAL') status = interpolate(t('paywall.trialActive'), { remaining: allowance.remaining, date: formatDate(allowance.trialEndsAt) });
  else if (allowance?.plan === 'FREE') status = interpolate(t('paywall.freeRemaining'), { remaining: allowance.remaining, limit: allowance.limit });
  const refresh = allowance?.plan === 'FREE' && allowance.remaining === 0 && allowance.resetsAt ? interpolate(t('paywall.freeRefresh'), { date: formatDate(allowance.resetsAt) }) : null;

  return (
    <Screen title={t('paywall.title')}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!subscription && !error ? <ActivityIndicator color="#2563eb" style={styles.loader} /> : null}
        {status ? (
          <View style={styles.statusCard}>
            <Text style={styles.statusText}>{status}</Text>
            {refresh ? <Text style={styles.statusHint}>{refresh}</Text> : null}
          </View>
        ) : null}
        {allowance?.plan === 'FREE' && allowance.remaining === 0 ? <Text style={styles.intro}>{t('paywall.upgradeRequired')}</Text> : null}

        {subscription?.trialAvailable ? (
          <View style={styles.trialCard}>
            <Text style={styles.trialTitle}>{t('paywall.trialTitle')}</Text>
            <Text style={styles.trialText}>{t('paywall.trialText')}</Text>
            <Pressable
              style={[styles.trialButton, busyPlan !== null && styles.disabled]}
              onPress={() => void onStartTrial()}
              disabled={busyPlan !== null}
              accessibilityRole="button"
            >
              {busyPlan === 'trial' ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.upgradeText}>{t('paywall.startTrial')}</Text>}
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{t('paywall.plansTitle')}</Text>
        {SUBSCRIPTION_PLANS.map((plan) => (
          <View key={plan.id} style={styles.planCard}>
            <View style={styles.planInfo}>
              <Text style={styles.planLabel}>{t(PLAN_LABELS[plan.id])}</Text>
              <Text style={styles.planMeta}>
                {formatInrPaise(plan.amount)} · {interpolate(t('paywall.aiNotesPerPlan'), { count: plan.aiQuota })}
              </Text>
            </View>
            <Pressable
              style={[styles.upgrade, busyPlan === plan.id && styles.disabled]}
              onPress={() => void onUpgrade(plan.id)}
              disabled={busyPlan !== null}
              accessibilityRole="button"
            >
              {busyPlan === plan.id ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.upgradeText}>{t('paywall.upgradeCta')}</Text>
              )}
            </Pressable>
          </View>
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {result ? <Text style={styles.success}>{result}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  loader: { marginVertical: 16 },
  intro: { fontSize: 14, color: '#374151', marginBottom: 16, lineHeight: 20 },
  statusCard: { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 14 },
  statusText: { color: '#065f46', fontWeight: '800', fontSize: 15 },
  statusHint: { color: '#047857', marginTop: 4, lineHeight: 19 },
  trialCard: { backgroundColor: '#172554', borderRadius: 14, padding: 16, marginBottom: 18 },
  trialTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  trialText: { color: '#dbeafe', marginTop: 6, lineHeight: 20 },
  trialButton: { alignSelf: 'flex-start', backgroundColor: '#f97316', borderRadius: 9, paddingVertical: 11, paddingHorizontal: 18, marginTop: 12, minWidth: 140, alignItems: 'center' },
  sectionTitle: { color: '#111827', fontSize: 16, fontWeight: '800', marginBottom: 10 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#ffffff',
  },
  planInfo: { flex: 1 },
  planLabel: { fontSize: 16, fontWeight: '700', color: '#111827' },
  planMeta: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  upgrade: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 110,
    alignItems: 'center',
  },
  disabled: { opacity: 0.6 },
  upgradeText: { color: '#ffffff', fontWeight: '700' },
  error: { color: '#b91c1c', fontSize: 14, marginTop: 12 },
  success: { color: '#15803d', fontSize: 14, marginTop: 12 },
});
