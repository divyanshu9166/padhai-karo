import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { interpolate, useTranslation, type Translate } from '@/localization';
import type { MoreStackScreenProps } from '@/navigation/types';

import { getWeeklyReview } from './todayApi';
import { generateTimetable } from '@/api/timetable';

function hours(t: Translate, minutes: number): string {
    return minutes >= 60 ? interpolate(t('weekly.hours'), { h: (minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1) }) : interpolate(t('today.minutes'), { m: minutes });
}

/** A calm weekly reflection that turns logged work into the next practical adjustment. */
export function WeeklyReviewScreen({ navigation }: MoreStackScreenProps<'WeeklyReview'>): React.JSX.Element {
    const t = useTranslation();
    const [review, setReview] = useState<Awaited<ReturnType<typeof getWeeklyReview>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [building, setBuilding] = useState(false);
    const shareCardRef = useRef<ViewShot>(null);

    const load = useCallback(async (): Promise<void> => {
        try { setError(null); setReview(await getWeeklyReview()); }
        catch (caught) { setError(caught instanceof ApiError ? caught.message : t('weekly.loadError')); }
        finally { setLoading(false); }
    }, [t]);
    useEffect(() => { void load(); }, [load]);

    if (loading && !review) return <Screen title={t('nav.weeklyReview')}><View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View></Screen>;
    if (!review) return <Screen title={t('nav.weeklyReview')}><View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable style={styles.primary} onPress={() => void load()}><Text style={styles.primaryText}>{t('common.retry')}</Text></Pressable></View></Screen>;

    const planMessage = review.plan.total === 0
        ? t('weekly.planEmpty')
        : review.plan.completionPercent >= 80
            ? t('weekly.planGood')
            : review.plan.completionPercent >= 50
                ? t('weekly.planAmbitious')
                : t('weekly.planReset');
    const practiceMessage = review.practice.questions === 0
        ? t('weekly.practiceNone')
        : review.practice.accuracyPercent === null
            ? interpolate(t('weekly.practiceLogged'), { count: review.practice.questions })
            : interpolate(t('weekly.practiceAccuracy'), { count: review.practice.questions, accuracy: Math.round(review.practice.accuracyPercent) });
    const buildNextWeek = async (): Promise<void> => {
        const now = new Date(); const day = (now.getUTCDay() + 6) % 7;
        const nextMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 7));
        setBuilding(true);
        try { await generateTimetable(nextMonday.toISOString()); navigation.getParent()?.navigate('Plan'); }
        catch (caught) { setError(caught instanceof ApiError ? caught.message : t('weekly.buildError')); }
        finally { setBuilding(false); }
    };
    const shareProgress = async (): Promise<void> => {
        const fallback = async (): Promise<void> => {
            await Share.share({ title: t('weekly.shareTitle'), message: `${t('weekly.shareHeading')}\n${interpolate(t('weekly.shareText'), { focused: hours(t, review.focusedMinutes), plan: review.plan.completionPercent, questions: review.practice.questions, days: review.consistencyDays })}${review.practice.accuracyPercent === null ? '' : ` · ${interpolate(t('weekly.accuracy'), { accuracy: Math.round(review.practice.accuracyPercent) })}`}.` });
        };
        try {
            const uri = await shareCardRef.current?.capture?.();
            if (uri && await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('weekly.shareDialog') });
                return;
            }
        } catch {
            // Web, simulator, and a restricted device can fall back to the native text sheet.
        }
        await fallback();
    };

    return <Screen title={t('nav.weeklyReview')}><ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}>
        <View style={styles.hero}><Text style={styles.eyebrow}>{t('weekly.eyebrow')}</Text><Text style={styles.title}>{t('weekly.heroTitle')}</Text><Text style={styles.heroText}>{t('weekly.heroText')}</Text></View>
        <ViewShot ref={shareCardRef} options={{ format: 'png', quality: 0.95, result: 'tmpfile' }} style={styles.shareCard}>
            <Text style={styles.shareEyebrow}>{t('weekly.shareEyebrow')}</Text>
            <Text style={styles.shareTitle}>{t('weekly.shareCardTitle')}</Text>
            <View style={styles.shareMetricRow}><ShareMetric value={hours(t, review.focusedMinutes)} label={t('weekly.focused')} /><ShareMetric value={`${review.plan.completionPercent}%`} label={t('weekly.planDone')} /><ShareMetric value={`${review.consistencyDays}/7`} label={t('weekly.days')} /></View>
            <Text style={styles.shareFooter}>{interpolate(t('weekly.questionsPractised'), { count: review.practice.questions })}{review.practice.accuracyPercent === null ? '' : ` · ${interpolate(t('weekly.accuracy'), { accuracy: Math.round(review.practice.accuracyPercent) })}`}</Text>
        </ViewShot>
        <View style={styles.metricRow}><Metric label={t('weekly.focused')} value={hours(t, review.focusedMinutes)} /><Metric label={t('weekly.consistentDays')} value={`${review.consistencyDays}/7`} /><Metric label={t('weekly.planDone')} value={`${review.plan.completionPercent}%`} /></View>
        <View style={styles.card}><Text style={styles.heading}>{t('weekly.whatHappened')}</Text><Text style={styles.body}>{interpolate(t('weekly.tasksCompleted'), { completed: review.plan.completed, total: review.plan.total })}{review.plan.missed ? ` ${interpolate(t('weekly.tasksMissed'), { count: review.plan.missed })}` : ''}</Text><Text style={styles.body}>{interpolate(t('weekly.revisionCompleted'), { count: review.revisionCompleted })}</Text><Text style={styles.body}>{practiceMessage}</Text></View>
        <View style={styles.nextCard}><Text style={styles.heading}>{t('weekly.adjustment')}</Text><Text style={styles.body}>{planMessage}</Text>{review.biggestWeakness ? <Text style={styles.weakness}>{t('weekly.prioritise')}: {review.biggestWeakness}</Text> : <Text style={styles.muted}>{t('weekly.keepLogging')}</Text>}</View>
        {error ? <Text style={styles.error}>{error}</Text> : null}<Pressable style={styles.primary} disabled={building} onPress={() => void buildNextWeek()}><Text style={styles.primaryText}>{building ? t('weekly.building') : t('weekly.buildNext')}</Text></Pressable><Pressable style={styles.share} onPress={() => void shareProgress()}><Text style={styles.shareText}>{t('weekly.shareProgress')}</Text></Pressable>
    </ScrollView></Screen>;
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
    return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function ShareMetric({ label, value }: { label: string; value: string }): React.JSX.Element {
    return <View style={styles.shareMetric}><Text style={styles.shareMetricValue}>{value}</Text><Text style={styles.shareMetricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 34 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }, error: { color: '#b91c1c', textAlign: 'center' },
    hero: { backgroundColor: '#172554', borderRadius: 18, padding: 18, marginBottom: 12 }, eyebrow: { color: '#bfdbfe', fontSize: 10, letterSpacing: .7, fontWeight: '800' }, title: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 8 }, heroText: { color: '#dbeafe', marginTop: 6, lineHeight: 20 },
    metricRow: { flexDirection: 'row', gap: 8, marginBottom: 12 }, metric: { flex: 1, padding: 11, borderRadius: 12, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#dbeafe' }, metricValue: { color: '#1d4ed8', fontSize: 19, fontWeight: '800' }, metricLabel: { color: '#475569', fontSize: 11, marginTop: 3 },
    shareCard: { backgroundColor: '#0f2a56', borderRadius: 16, padding: 17, marginBottom: 12 }, shareEyebrow: { color: '#bfdbfe', fontSize: 10, letterSpacing: .8, fontWeight: '800' }, shareTitle: { color: '#fff', fontSize: 21, fontWeight: '800', marginTop: 7 }, shareMetricRow: { flexDirection: 'row', gap: 8, marginTop: 15 }, shareMetric: { flex: 1, borderRadius: 10, backgroundColor: '#173b76', padding: 10 }, shareMetricValue: { color: '#fff', fontSize: 18, fontWeight: '800' }, shareMetricLabel: { color: '#bfdbfe', fontSize: 10, marginTop: 3 }, shareFooter: { color: '#dbeafe', marginTop: 12, fontSize: 12 },
    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 14, marginBottom: 10 }, nextCard: { backgroundColor: '#f5f3ff', borderWidth: 1, borderColor: '#ddd6fe', borderRadius: 14, padding: 14, marginBottom: 12 }, heading: { color: '#0f172a', fontSize: 17, fontWeight: '800', marginBottom: 7 }, body: { color: '#334155', lineHeight: 21, marginBottom: 5 }, muted: { color: '#64748b', lineHeight: 20 }, weakness: { color: '#6d28d9', fontWeight: '800', marginTop: 8 },
    primary: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 13, alignItems: 'center' }, primaryText: { color: '#fff', fontWeight: '800' }, share: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 9 }, shareText: { color: '#1d4ed8', fontWeight: '800' },
});
