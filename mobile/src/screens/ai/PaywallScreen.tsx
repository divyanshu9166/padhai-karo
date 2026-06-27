/**
 * Subscription / paywall screen (task 21.7; Req 9.5).
 *
 * Presents the purchasable plans, then runs the order → checkout → verify flow:
 * `POST /subscriptions/order` → (native Razorpay checkout, stubbed) → `POST /subscriptions/verify`.
 * On a verified upgrade the server grants the PAID tier + AI quota (Req 9.5); the screen shows
 * the result. The checkout + upload integrations are documented placeholders (see ai/api.ts).
 */
import React, { useState } from 'react';
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
import { useTranslation } from '@/localization';

import {
  SUBSCRIPTION_PLANS,
  createSubscriptionOrder,
  formatInrPaise,
  runRazorpayCheckoutPlaceholder,
  verifySubscription,
  type SubscriptionPlanId,
} from './api';

export function PaywallScreen(): React.JSX.Element {
  const t = useTranslation();

  const [busyPlan, setBusyPlan] = useState<SubscriptionPlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

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
      setResult(`Upgraded to ${verified.tier}. AI quota: ${verified.aiQuota}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete the upgrade.');
    } finally {
      setBusyPlan(null);
    }
  };

  return (
    <Screen title={t('paywall.title')}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>{t('paywall.upgradeRequired')}</Text>

        {SUBSCRIPTION_PLANS.map((plan) => (
          <View key={plan.id} style={styles.planCard}>
            <View style={styles.planInfo}>
              <Text style={styles.planLabel}>{plan.label}</Text>
              <Text style={styles.planMeta}>
                {formatInrPaise(plan.amount)} · {plan.aiQuota} summaries
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
  intro: { fontSize: 14, color: '#374151', marginBottom: 16, lineHeight: 20 },
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
