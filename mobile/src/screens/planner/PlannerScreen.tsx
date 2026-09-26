import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { interpolate, useTranslation } from '@/localization';
import type { PlanStackScreenProps } from '@/navigation/types';
import { cacheJson, readCachedJson } from '@/offline/cache';
import { listStudyTasks, updateStudyTask, type StudyTask } from '@/screens/dashboard/todayApi';

import { createExamDate, disconnectGoogleCalendar, getDailyBriefing, getGoogleCalendarConnectUrl, getGoogleCalendarStatus, getPlanningOverview, getRevisionSchedule, importGoogleCalendar, refreshDailyBriefing, type DailyBriefing, type PlanningOverview, type RevisionSequence } from '@/api/upscProduct';

export function PlannerScreen({ navigation }: PlanStackScreenProps<'Plan'>): React.JSX.Element {
    const t = useTranslation();
    const [overview, setOverview] = useState<PlanningOverview | null>(null);
    const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
    const [calendarConnected, setCalendarConnected] = useState(false);
    const [calendarLastImported, setCalendarLastImported] = useState<string | null>(null);
    const [revisionSequences, setRevisionSequences] = useState<RevisionSequence[]>([]);
    const [examLabel, setExamLabel] = useState(t('planner.mainExam'));
    const [examDate, setExamDate] = useState('');
    const [planTasks, setPlanTasks] = useState<StudyTask[]>([]);
    const briefingActions = briefing?.insights.source === 'AI' && briefing.insights.ai?.keyPoints?.length
        ? briefing.insights.ai.keyPoints
        : briefing?.insights.actions ?? [];

    const load = useCallback(async (): Promise<void> => {
        setError(null);
        const today = new Date(); const from = today.toISOString().slice(0, 10); const to = new Date(today.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
        const [overviewResult, briefingResult, calendarResult, revisionsResult, tasksResult] = await Promise.allSettled([
            getPlanningOverview(),
            getDailyBriefing(),
            getGoogleCalendarStatus(),
            getRevisionSchedule(),
            listStudyTasks({ from, to, includeInbox: true }),
        ]);
        const failures: string[] = [];
        if (overviewResult.status === 'fulfilled') {
            setOverview(overviewResult.value);
            await cacheJson('planning-overview', overviewResult.value);
        } else {
            failures.push(overviewResult.reason instanceof ApiError ? overviewResult.reason.message : t('planner.loadError'));
            const cachedOverview = await readCachedJson<PlanningOverview>('planning-overview');
            if (cachedOverview) setOverview(cachedOverview.value);
        }
        if (briefingResult.status === 'fulfilled') {
            setBriefing(briefingResult.value.briefing);
            await cacheJson('daily-briefing', briefingResult.value.briefing);
        } else {
            const cachedBriefing = await readCachedJson<DailyBriefing>('daily-briefing');
            if (cachedBriefing) setBriefing(cachedBriefing.value);
        }
        if (calendarResult.status === 'fulfilled') {
            setCalendarConnected(calendarResult.value.connected);
            setCalendarLastImported(calendarResult.value.connection?.lastImportedAt ?? null);
        }
        if (revisionsResult.status === 'fulfilled') setRevisionSequences(revisionsResult.value.sequences);
        if (tasksResult.status === 'fulfilled') setPlanTasks(tasksResult.value.tasks);
        if (failures.length > 0) setError(failures[0]);
    }, [t]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const subscription = Linking.addEventListener('url', ({ url }) => {
            if (url.includes('calendar/google/callback')) setCalendarMessage(url.includes('connected=1') ? t('planner.googleConnected') : t('planner.googleReturned'));
        });
        return () => subscription.remove();
    }, []);

    const refreshBriefing = async (): Promise<void> => {
        setBusy(true);
        try { setBriefing((await refreshDailyBriefing()).briefing); } catch (err) { setError(err instanceof ApiError ? err.message : t('planner.briefingRefreshError')); } finally { setBusy(false); }
    };

    const connectCalendar = async (): Promise<void> => {
        try {
            const { authorizationUrl } = await getGoogleCalendarConnectUrl();
            await Linking.openURL(authorizationUrl);
            setCalendarMessage(t('planner.googleOpened'));
        } catch (err) { setCalendarMessage(err instanceof ApiError ? err.message : t('planner.googleNotConfigured')); }
    };

    const syncCalendar = async (): Promise<void> => {
        try { const result = await importGoogleCalendar(); setCalendarConnected(true); setCalendarLastImported(new Date().toISOString()); setCalendarMessage(interpolate(t('planner.eventsImported'), { count: result.imported })); } catch (err) { setCalendarMessage(err instanceof ApiError ? err.message : t('planner.importError')); }
    };

    const disconnectCalendar = async (): Promise<void> => { try { await disconnectGoogleCalendar(); setCalendarConnected(false); setCalendarLastImported(null); setCalendarMessage(t('planner.googleDisconnected')); } catch (err) { setCalendarMessage(err instanceof ApiError ? err.message : t('planner.disconnectError')); } };

    const addExamDate = async (): Promise<void> => {
        if (!examLabel.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) { setCalendarMessage(t('planner.examDateInvalid')); return; }
        try { await createExamDate({ label: examLabel.trim(), examDate, priority: 5, examProgram: overview?.exam.program ?? undefined, examStage: overview?.exam.stage ?? undefined }); setCalendarMessage(t('planner.examDateSaved')); setExamDate(''); await load(); } catch (err) { setCalendarMessage(err instanceof ApiError ? err.message : t('planner.examDateError')); }
    };
    const scheduleInboxTask = async (task: StudyTask, daysFromNow: number): Promise<void> => {
        const date = new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
        try { const result = await updateStudyTask(task.id, { scheduledDate: date, status: 'PENDING' }); setPlanTasks((items) => items.map((item) => item.id === task.id ? result.task : item)); }
        catch (caught) { setError(caught instanceof ApiError ? caught.message : t('planner.scheduleError')); }
    };
    const dateLabel = (value: string | null): string => !value ? t('planner.inbox') : value.slice(0, 10) === new Date().toISOString().slice(0, 10) ? t('planner.today') : value.slice(0, 10) === new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) ? t('planner.tomorrow') : new Date(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

    return (
        <Screen title={t('planner.title')}>
            {overview === null ? <View style={styles.centered}><ActivityIndicator color="#2563eb" /><Text style={styles.error}>{error ?? t('planner.loadError')}</Text><Pressable style={styles.secondary} onPress={() => void load()}><Text style={styles.secondaryText}>{t('common.retry')}</Text></Pressable></View> : (
                <ScrollView contentContainerStyle={styles.scroll}>
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                    <View style={styles.hero}>
                        <Text style={styles.phase}>{overview.exam.phase.replace('_', ' ')}</Text>
                        <Text style={styles.countdown}>{overview.exam.countdownDays === null ? t('planner.setExamDate') : `${Math.max(0, overview.exam.countdownDays)} ${t('planner.daysToGo')}`}</Text>
                        <Text style={styles.meta}>{overview.exam.program ?? 'UPSC/SSC'} {overview.exam.stage ?? ''}</Text>
                    </View>
                    <View style={styles.row}>
                        <Stat label={t('planner.timeDebt')} value={`${overview.time.timeDebtMin}m`} />
                        <Stat label={t('planner.efficiency')} value={`${overview.time.averageEfficiencyPercent}%`} />
                        <Stat label={t('planner.dailyTarget')} value={`${overview.time.recommendedDailyMin}m`} />
                    </View>
                    <View style={styles.card}><Text style={styles.heading}>{t('planner.actionPlan')}</Text><Text style={styles.body}>{t('planner.actionPlanText')}</Text>{planTasks.length === 0 ? <Text style={styles.muted}>{t('planner.noTasks')}</Text> : planTasks.slice(0, 14).map((task) => <View key={task.id} style={styles.taskRow}><View style={styles.taskCopy}><Text style={styles.priorityName}>{task.title}</Text><Text style={styles.muted}>{dateLabel(task.scheduledDate)} · {interpolate(t('today.minutes'), { m: task.plannedMinutes })} · {t(`taskType.${task.taskType}`)}</Text></View>{task.scheduledDate ? null : <View style={styles.taskActions}><Pressable style={styles.smallAction} onPress={() => void scheduleInboxTask(task, 0)}><Text style={styles.smallActionText}>{t('planner.today')}</Text></Pressable><Pressable style={styles.smallAction} onPress={() => void scheduleInboxTask(task, 1)}><Text style={styles.smallActionText}>{t('planner.tomorrow')}</Text></Pressable></View>}</View>)}</View>
                    <View style={styles.card}><Text style={styles.heading}>{t('planner.prepPlan')}</Text><Text style={styles.body}>{t('planner.prepPlanText')}</Text><Pressable style={styles.secondary} onPress={() => navigation.navigate('Timetable')}><Text style={styles.secondaryText}>{t('planner.openCalendar')}</Text></Pressable></View>
                    <View style={styles.card}><Text style={styles.heading}>{t('planner.revisionCycle')}</Text><Text style={styles.body}>{overview.revision?.dueCount ?? 0} {t('planner.revisionBody')}</Text>{revisionSequences.slice(0, 5).map((sequence) => <View key={sequence.chapterId} style={styles.revisionSequence}><Text style={styles.priorityName}>{sequence.chapterName}</Text>{sequence.phases.map((phase) => <Text key={phase.phase} style={styles.muted}>{phase.label}: {phase.dueAt ? new Date(phase.dueAt).toLocaleDateString() : t('common.pending')}</Text>)}</View>)}{revisionSequences.length === 0 ? <Text style={styles.muted}>{t('planner.noRevisionSequence')}</Text> : null}</View>
                    <View style={styles.card}><Text style={styles.heading}>{t('planner.examCountdown')}</Text><Text style={styles.body}>{t('planner.examCountdownBody')}</Text><TextInput style={styles.input} value={examLabel} onChangeText={setExamLabel} placeholder={t('planner.examLabel')} /><TextInput style={styles.input} value={examDate} onChangeText={setExamDate} placeholder="YYYY-MM-DD" autoCapitalize="none" /><Pressable style={styles.secondary} onPress={() => void addExamDate()}><Text style={styles.secondaryText}>{t('planner.saveExamDate')}</Text></Pressable>{overview.exam.dates.slice(0, 5).map((date) => <Text key={date.id} style={styles.muted}>{date.label}: {date.examDate.slice(0, 10)}</Text>)}</View>
                    <View style={styles.card}>
                        <Text style={styles.heading}>{t('planner.priorityTopics')}</Text><Text style={styles.muted}>{t('planner.signalsNote')}</Text>
                        {overview.priorities.length === 0 ? <Text style={styles.muted}>{t('planner.syllabusClear')}</Text> : overview.priorities.slice(0, 5).map((priority, index) => <View key={priority.id} style={[styles.priorityCard, index === 0 && styles.priorityCardLead]}><View style={styles.priorityTop}><Text style={styles.priorityName}>{priority.name}</Text><Text style={styles.priorityBadge}>{index === 0 ? t('planner.startHere') : interpolate(t('today.priority'), { n: index + 1 })}</Text></View><Text style={styles.priorityReason}>{priority.reason.replaceAll('_', ' ').toLowerCase()}</Text><Text style={styles.priorityHint}>{index === 0 ? t('planner.beginFocused') : t('planner.keepNext')}</Text></View>)}
                    </View>
                    {briefing ? <View style={styles.card}><Text style={styles.heading}>{briefing.insights.ai?.title ?? t('planner.dailyBriefing')}</Text><Text style={styles.badge}>{briefing.insights.source === 'AI' && briefing.insights.ai?.keyPoints?.length ? t('planner.aiBriefing') : t('planner.ruleBriefing')}</Text><Text style={styles.body}>{briefing.insights.greeting}</Text>{briefingActions.map((action, index) => <Text key={`${index}-${action}`} style={styles.bullet}>• {action}</Text>)}<Pressable style={styles.button} onPress={() => void refreshBriefing()} disabled={busy}><Text style={styles.buttonText}>{busy ? t('planner.refreshing') : t('planner.refreshBriefing')}</Text></Pressable></View> : null}
                    <View style={styles.card}><Text style={styles.heading}>{t('planner.calendarCommitments')}</Text><Text style={styles.body}>{t('planner.calendarBody')}</Text><Text style={styles.muted}>{calendarConnected ? `${t('planner.connected')}${calendarLastImported ? ` · ${interpolate(t('planner.lastImport'), { date: new Date(calendarLastImported).toLocaleString() })}` : ''}` : t('planner.notConnected')}</Text><View style={styles.buttonRow}>{calendarConnected ? <Pressable style={styles.secondary} onPress={() => void disconnectCalendar()}><Text style={styles.secondaryText}>{t('planner.disconnect')}</Text></Pressable> : <Pressable style={styles.secondary} onPress={() => void connectCalendar()}><Text style={styles.secondaryText}>{t('planner.connectGoogle')}</Text></Pressable>}<Pressable style={styles.secondary} onPress={() => void syncCalendar()}><Text style={styles.secondaryText}>{t('planner.importEvents')}</Text></Pressable></View>{calendarMessage ? <Text style={styles.muted}>{calendarMessage}</Text> : null}</View>
                </ScrollView>
            )}
        </Screen>
    );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 }, centered: { flex: 1, justifyContent: 'center', alignItems: 'center' }, error: { color: '#b91c1c', marginBottom: 10 }, input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, marginTop: 8, color: '#111827' },
    hero: { backgroundColor: '#eff6ff', borderRadius: 16, padding: 18, marginBottom: 12 }, phase: { color: '#1d4ed8', fontWeight: '800', fontSize: 13, textTransform: 'uppercase' }, countdown: { color: '#111827', fontWeight: '800', fontSize: 26, marginTop: 4 }, meta: { color: '#4b5563', marginTop: 4 },
    row: { flexDirection: 'row', marginBottom: 12 }, stat: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 10, padding: 10, marginRight: 6 }, statValue: { fontSize: 18, fontWeight: '800', color: '#111827' }, statLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 }, revisionSequence: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 8, marginTop: 8 },
    card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 12, backgroundColor: '#fff' }, heading: { fontWeight: '800', fontSize: 16, color: '#111827', marginBottom: 8 }, badge: { alignSelf: 'flex-start', color: '#1d4ed8', backgroundColor: '#eff6ff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, fontWeight: '700', marginBottom: 8 }, body: { color: '#374151', lineHeight: 20, marginBottom: 8 }, bullet: { color: '#374151', marginTop: 5, lineHeight: 19 }, muted: { color: '#6b7280', marginTop: 8, lineHeight: 19 }, taskRow: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, marginTop: 8, flexDirection: 'row', gap: 8 }, taskCopy: { flex: 1 }, taskActions: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 }, smallAction: { borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 6 }, smallActionText: { color: '#1d4ed8', fontSize: 11, fontWeight: '800' }, priorityCard: { backgroundColor: '#f8fafc', borderRadius: 11, padding: 12, marginTop: 9, borderWidth: 1, borderColor: '#e2e8f0' }, priorityCardLead: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }, priorityTop: { flexDirection: 'row', alignItems: 'center', gap: 8 }, priorityName: { flex: 1, color: '#111827', fontWeight: '800', fontSize: 15 }, priorityBadge: { color: '#1d4ed8', fontWeight: '800', fontSize: 10 }, priorityReason: { color: '#334155', lineHeight: 19, marginTop: 7, textTransform: 'capitalize' }, priorityHint: { color: '#64748b', lineHeight: 18, marginTop: 5, fontSize: 12 }, button: { backgroundColor: '#2563eb', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 12 }, buttonText: { color: '#fff', fontWeight: '700' }, buttonRow: { flexDirection: 'row', flexWrap: 'wrap' }, secondary: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, padding: 10, marginRight: 8, marginTop: 4 }, secondaryText: { color: '#2563eb', fontWeight: '700' },
});
