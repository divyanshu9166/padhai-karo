import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import type { MoreStackScreenProps } from '@/navigation/types';

import { getWeeklyReview } from './todayApi';
import { generateTimetable } from '@/api/timetable';

function hours(minutes: number): string {
    return minutes >= 60 ? `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h` : `${minutes} min`;
}

/** A calm weekly reflection that turns logged work into the next practical adjustment. */
export function WeeklyReviewScreen({ navigation }: MoreStackScreenProps<'WeeklyReview'>): React.JSX.Element {
    const [review, setReview] = useState<Awaited<ReturnType<typeof getWeeklyReview>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [building, setBuilding] = useState(false);
    const shareCardRef = useRef<ViewShot>(null);

    const load = useCallback(async (): Promise<void> => {
        try { setError(null); setReview(await getWeeklyReview()); }
        catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Your weekly review could not load.'); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    if (loading && !review) return <Screen title="Weekly review"><View style={styles.center}><ActivityIndicator color="#2563eb" size="large" /></View></Screen>;
    if (!review) return <Screen title="Weekly review"><View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable style={styles.primary} onPress={() => void load()}><Text style={styles.primaryText}>Try again</Text></Pressable></View></Screen>;

    const planMessage = review.plan.total === 0
        ? 'Build a realistic week so the app can adapt it with you.'
        : review.plan.completionPercent >= 80
            ? 'Your plan matched your real week well. Keep the same workload, then make one focused improvement.'
            : review.plan.completionPercent >= 50
                ? 'The workload was a little ambitious. Protect your highest-value sessions and use buffers for the rest.'
                : 'This week needs a lighter reset. Move non-essential tasks to Inbox, then plan fewer, clearer sessions.';
    const practiceMessage = review.practice.questions === 0
        ? 'Add one short PYQ or timed-practice session next week to keep feedback connected to your plan.'
        : review.practice.accuracyPercent === null
            ? `${review.practice.questions} practice questions logged. Review mistakes before adding more volume.`
            : `${review.practice.questions} questions practised at ${Math.round(review.practice.accuracyPercent)}% accuracy.`;
    const buildNextWeek = async (): Promise<void> => {
        const now = new Date(); const day = (now.getUTCDay() + 6) % 7;
        const nextMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 7));
        setBuilding(true);
        try { await generateTimetable(nextMonday.toISOString()); navigation.getParent()?.navigate('Plan'); }
        catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Next week could not be built.'); }
        finally { setBuilding(false); }
    };
    const shareProgress = async (): Promise<void> => {
        const fallback = async (): Promise<void> => {
            await Share.share({ title: 'My Padhai Karo week', message: `My study week\n${hours(review.focusedMinutes)} focused · ${review.plan.completionPercent}% plan completed · ${review.practice.questions} practice questions · ${review.consistencyDays}/7 consistent days${review.practice.accuracyPercent === null ? '' : ` · ${Math.round(review.practice.accuracyPercent)}% accuracy`}.` });
        };
        try {
            const uri = await shareCardRef.current?.capture?.();
            if (uri && await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your study week' });
                return;
            }
        } catch {
            // Web, simulator, and a restricted device can fall back to the native text sheet.
        }
        await fallback();
    };

    return <Screen title="Weekly review"><ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}>
        <View style={styles.hero}><Text style={styles.eyebrow}>PLAN → FOCUS → PRACTICE → REVIEW</Text><Text style={styles.title}>Your week, honestly reviewed.</Text><Text style={styles.heroText}>Use this to make next week more achievable—not to judge yourself.</Text></View>
        <ViewShot ref={shareCardRef} options={{ format: 'png', quality: 0.95, result: 'tmpfile' }} style={styles.shareCard}>
            <Text style={styles.shareEyebrow}>PADHAI KARO · WEEKLY PROGRESS</Text>
            <Text style={styles.shareTitle}>One honest week at a time.</Text>
            <View style={styles.shareMetricRow}><ShareMetric value={hours(review.focusedMinutes)} label="Focused" /><ShareMetric value={`${review.plan.completionPercent}%`} label="Plan done" /><ShareMetric value={`${review.consistencyDays}/7`} label="Days" /></View>
            <Text style={styles.shareFooter}>{review.practice.questions} questions practised{review.practice.accuracyPercent === null ? '' : ` · ${Math.round(review.practice.accuracyPercent)}% accuracy`}</Text>
        </ViewShot>
        <View style={styles.metricRow}><Metric label="Focused" value={hours(review.focusedMinutes)} /><Metric label="Consistent days" value={`${review.consistencyDays}/7`} /><Metric label="Plan done" value={`${review.plan.completionPercent}%`} /></View>
        <View style={styles.card}><Text style={styles.heading}>What happened</Text><Text style={styles.body}>{review.plan.completed} of {review.plan.total} planned tasks were completed{review.plan.missed ? `; ${review.plan.missed} were missed.` : '.'}</Text><Text style={styles.body}>{review.revisionCompleted} revision cards completed.</Text><Text style={styles.body}>{practiceMessage}</Text></View>
        <View style={styles.nextCard}><Text style={styles.heading}>One adjustment for next week</Text><Text style={styles.body}>{planMessage}</Text>{review.biggestWeakness ? <Text style={styles.weakness}>Prioritise: {review.biggestWeakness}</Text> : <Text style={styles.muted}>Keep logging practice to reveal the area that needs the most attention.</Text>}</View>
        {error ? <Text style={styles.error}>{error}</Text> : null}<Pressable style={styles.primary} disabled={building} onPress={() => void buildNextWeek()}><Text style={styles.primaryText}>{building ? 'Building next week…' : 'Build my next week'}</Text></Pressable><Pressable style={styles.share} onPress={() => void shareProgress()}><Text style={styles.shareText}>Share weekly progress</Text></Pressable>
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
