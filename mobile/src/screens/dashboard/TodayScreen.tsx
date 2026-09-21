import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api';
import { createDoubt, createResource, createRevisionCard, getDailyBriefing, saveWellbeing, type DailyBriefing } from '@/api/upscProduct';
import { Screen } from '@/components';
import type { MainTabScreenProps } from '@/navigation/types';

import { getToday, quickCapture, rescueBacklog, updateStudyTask, type StudyTask, type TaskType, type TodayResponse } from './todayApi';

type CaptureKind = 'TASK' | 'DOUBT' | 'REVISION' | 'NOTE';

function minutes(value: number): string { return value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value} min`; }

function sessionType(taskType: TaskType): import('@/screens/focus/sessionTypes').SessionType {
    if (taskType === 'REVISION') return 'REVISION';
    if (taskType === 'NOTES_MAKING') return 'NOTES_MAKING';
    if (taskType === 'PYQ_PRACTICE') return 'PRACTICE_PROBLEMS';
    if (taskType === 'ANSWER_WRITING') return 'ANSWER_WRITING';
    if (taskType === 'MOCK_TEST') return 'MOCK_TEST';
    if (taskType === 'MOCK_ANALYSIS') return 'MOCK_ANALYSIS';
    if (taskType === 'CURRENT_AFFAIRS') return 'CURRENT_AFFAIRS';
    if (taskType === 'QUANT_PRACTICE') return 'QUANT_PRACTICE';
    if (taskType === 'REASONING_PRACTICE') return 'REASONING_PRACTICE';
    if (taskType === 'FORMULA_REVISION') return 'FORMULA_DRILL';
    if (taskType === 'VOCABULARY') return 'VOCABULARY';
    return 'NEW_CHAPTER';
}

function actionLabel(task: StudyTask): string {
    if (task.taskType === 'REVISION') return 'Start revision';
    if (task.taskType === 'PYQ_PRACTICE' || task.taskType === 'QUANT_PRACTICE' || task.taskType === 'REASONING_PRACTICE') return 'Start practice';
    if (task.taskType === 'ANSWER_WRITING') return 'Start writing';
    return 'Start focus';
}

/** Action-first home: shows the learner exactly what to do now, not a wall of statistics. */
export function TodayScreen({ navigation }: MainTabScreenProps<'Dashboard'>): React.JSX.Element {
    const [data, setData] = useState<TodayResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [capture, setCapture] = useState('');
    const [captureKind, setCaptureKind] = useState<CaptureKind>('TASK');
    const [savingCapture, setSavingCapture] = useState(false);
    const [rescuing, setRescuing] = useState(false);
    const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
    const [mood, setMood] = useState(3);
    const [energy, setEnergy] = useState(3);
    const [sleepHours, setSleepHours] = useState('7');
    const [savingCheckin, setSavingCheckin] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        try { setError(null); const [today, dailyBriefing] = await Promise.all([getToday(), getDailyBriefing().catch(() => null)]); setData(today); setBriefing(dailyBriefing?.briefing ?? null); }
        catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load today’s plan.'); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const complete = async (task: StudyTask): Promise<void> => {
        try {
            const { task: updated } = await updateStudyTask(task.id, { status: 'COMPLETED' });
            setData((previous) => previous ? { ...previous, tasks: previous.tasks.map((item) => item.id === updated.id ? updated : item), progress: { ...previous.progress, completed: previous.progress.completed + (task.status === 'COMPLETED' ? 0 : 1) } } : previous);
        } catch (caught) { Alert.alert('Could not complete task', caught instanceof ApiError ? caught.message : 'Try again.'); }
    };

    const startTask = async (task: StudyTask): Promise<void> => {
        try {
            const { task: updated } = task.status === 'PENDING' || task.status === 'MISSED'
                ? await updateStudyTask(task.id, { status: 'IN_PROGRESS' })
                : { task };
            navigation.navigate('Focus', { task: { id: updated.id, title: updated.title, subjectId: updated.subjectId, plannedMinutes: updated.plannedMinutes, sessionType: sessionType(updated.taskType) } });
        } catch (caught) { Alert.alert('Could not start task', caught instanceof ApiError ? caught.message : 'Try again.'); }
    };

    const saveCapture = async (): Promise<void> => {
        if (!capture.trim()) return;
        setSavingCapture(true);
        try {
            const value = capture.trim();
            if (captureKind === 'DOUBT') await createDoubt({ title: value.slice(0, 90), question: value, tags: ['quick-capture'] });
            else if (captureKind === 'REVISION') await createRevisionCard({ title: value.slice(0, 90), prompt: value, answer: 'Add the answer or your key points when you revise this.' , tags: ['quick-capture'] });
            else if (captureKind === 'NOTE') await createResource({ title: value, type: 'NOTE', tags: ['quick-capture', 'inbox'] });
            else await quickCapture(value);
            setCapture('');
            const destination = captureKind === 'TASK' ? 'Inbox' : captureKind === 'DOUBT' ? 'doubt list' : captureKind === 'REVISION' ? 'revision queue' : 'library';
            Alert.alert('Captured', `Saved to your ${destination}.`);
        }
        catch (caught) { Alert.alert('Could not save', caught instanceof ApiError ? caught.message : 'Try again.'); }
        finally { setSavingCapture(false); }
    };

    const runRescue = async (input: { days?: 3 | 7; mode?: 'REDUCE_WORKLOAD' }): Promise<void> => {
        setRescuing(true);
        try { const result = await rescueBacklog(input); await load(); Alert.alert('Backlog rescue ready', `${result.rescued} tasks are spread across ${result.days} days (${minutes(result.dailyMinutes)} per day).${result.movedToInbox ? ` ${result.movedToInbox} lower-priority tasks moved to Inbox.` : ''}`); }
        catch (caught) { Alert.alert('Could not rebalance', caught instanceof ApiError ? caught.message : 'Try again.'); }
        finally { setRescuing(false); }
    };
    const saveCheckin = async (): Promise<void> => {
        const sleep = Number(sleepHours);
        if (!Number.isFinite(sleep) || sleep < 0 || sleep > 24) { Alert.alert('Check sleep hours', 'Enter a value from 0 to 24.'); return; }
        setSavingCheckin(true);
        try { await saveWellbeing({ mood, energy, stress: 6 - energy, sleepHours: sleep }); Alert.alert('Daily signal saved', 'Tomorrow’s recommendation will use your energy and sleep signal.'); }
        catch (caught) { Alert.alert('Could not save', caught instanceof ApiError ? caught.message : 'Try again.'); }
        finally { setSavingCheckin(false); }
    };

    if (loading && !data) return <Screen title="Today"><View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View></Screen>;
    if (!data) return <Screen title="Today"><View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable style={styles.primary} onPress={() => void load()}><Text style={styles.primaryText}>Try again</Text></Pressable></View></Screen>;

    const active = data.tasks.filter((task) => task.status !== 'COMPLETED');
    return <Screen title="Today"><ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}>
        <View style={styles.hero}><Text style={styles.eyebrow}>YOUR PREPARATION, ONE DAY AT A TIME</Text><Text style={styles.greeting}>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}</Text><Text style={styles.exam}>{data.profile?.examProgram === 'SSC_CGL' ? 'SSC CGL' : 'UPSC CSE'} {data.profile?.examStage?.replace('_', ' ')}</Text><Text style={styles.countdown}>{data.countdownDays === null ? 'Set your exam date in Plan' : `${data.countdownDays} days remaining`}</Text></View>
        {briefing ? <View style={styles.briefingCard}><Text style={styles.priority}>TODAY’S RECOMMENDATION</Text><Text style={styles.briefingText}>{briefing.insights.actions[0] ?? briefing.insights.greeting}</Text><Pressable onPress={() => navigation.navigate('Plan')}><Text style={styles.link}>See full plan</Text></Pressable></View> : null}

        <View style={styles.progressCard}><Text style={styles.progressTitle}>Today’s progress</Text><Text style={styles.progressValue}>{data.progress.completed} / {data.progress.total} tasks completed</Text><View style={styles.track}><View style={[styles.fill, { width: `${data.progress.total ? Math.min(100, data.progress.completed / data.progress.total * 100) : 0}%` }]} /></View><Text style={styles.muted}>{minutes(data.progress.focusedMinutes)} focused so far</Text></View>

        <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Today’s plan</Text><Pressable onPress={() => navigation.navigate('Plan')}><Text style={styles.link}>Open plan</Text></Pressable></View>
        {active.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Your plan is clear</Text><Text style={styles.muted}>Generate a weekly plan or add a task below to get started.</Text><Pressable style={styles.primary} onPress={() => navigation.navigate('Plan')}><Text style={styles.primaryText}>Build my plan</Text></Pressable></View> : active.slice(0, 5).map((task, index) => <View key={task.id} style={styles.taskCard}><View style={styles.taskTop}><Text style={styles.priority}>PRIORITY {index + 1}{task.priority === 'CRITICAL' ? ' · URGENT' : ''}</Text><Text style={styles.duration}>{minutes(task.plannedMinutes)}</Text></View><Text style={styles.taskTitle}>{task.title}</Text><Text style={styles.taskMeta}>{task.taskType.replaceAll('_', ' ')}{task.syllabusUnit ? ` · ${task.syllabusUnit}` : ''}</Text><View style={styles.actions}><Pressable style={styles.primarySmall} onPress={() => void startTask(task)}><Text style={styles.primaryText}>{actionLabel(task)}</Text></Pressable><Pressable style={styles.outlineSmall} onPress={() => void complete(task)}><Text style={styles.outlineText}>Mark done</Text></Pressable></View></View>)}

        <View style={styles.revisionCard}><View><Text style={styles.sectionTitle}>Revision due</Text><Text style={styles.muted}>{data.revisionDue} items are ready for recall.</Text></View><Pressable style={styles.outlineSmall} onPress={() => navigation.navigate('More', { screen: 'RecallStudio' })}><Text style={styles.outlineText}>Start revision</Text></Pressable></View>
        {data.currentAffairs ? <View style={styles.currentCard}><Text style={styles.priority}>CURRENT AFFAIRS · 15 MIN</Text><Text style={styles.taskTitle}>{data.currentAffairs.title}</Text><Text style={styles.taskMeta}>{data.currentAffairs.syllabusTags.join(' · ') || data.currentAffairs.category}</Text><Pressable style={styles.outlineSmall} onPress={() => navigation.navigate('More', { screen: 'Updates' })}><Text style={styles.outlineText}>Read and save</Text></Pressable></View> : null}

        {data.backlogCount > 0 ? <View style={styles.rescueCard}><Text style={styles.sectionTitle}>Backlog rescue</Text><Text style={styles.muted}>{data.backlogCount} unfinished tasks are from earlier days. Pick a realistic recovery pace.</Text><View style={styles.actions}><Pressable disabled={rescuing} style={styles.primarySmall} onPress={() => void runRescue({ days: 3 })}><Text style={styles.primaryText}>Recover in 3 days</Text></Pressable><Pressable disabled={rescuing} style={styles.outlineSmall} onPress={() => void runRescue({ days: 7 })}><Text style={styles.outlineText}>Recover in 7 days</Text></Pressable><Pressable disabled={rescuing} style={styles.textButton} onPress={() => void runRescue({ mode: 'REDUCE_WORKLOAD' })}><Text style={styles.link}>Reduce workload</Text></Pressable></View></View> : null}

        <View style={styles.wellbeingCard}><Text style={styles.sectionTitle}>Today’s energy signal</Text><Text style={styles.muted}>A quick check-in helps the plan stay realistic. It is not a performance score.</Text><Text style={styles.checkinLabel}>Mood</Text><View style={styles.captureKinds}>{([1, 2, 3, 4, 5]).map((value) => <Pressable key={value} style={[styles.captureKind, mood === value && styles.captureKindActive]} onPress={() => setMood(value)}><Text style={[styles.captureKindText, mood === value && styles.captureKindTextActive]}>{['😞', '😕', '😐', '🙂', '😄'][value - 1]}</Text></Pressable>)}</View><Text style={styles.checkinLabel}>Energy</Text><View style={styles.captureKinds}>{([1, 2, 3, 4, 5]).map((value) => <Pressable key={value} style={[styles.captureKind, energy === value && styles.captureKindActive]} onPress={() => setEnergy(value)}><Text style={[styles.captureKindText, energy === value && styles.captureKindTextActive]}>{['Low', 'Low+', 'Normal', 'High', 'High+'][value - 1]}</Text></Pressable>)}</View><TextInput style={styles.input} value={sleepHours} onChangeText={setSleepHours} keyboardType="decimal-pad" placeholder="Sleep hours" /><Pressable style={styles.outlineSmall} disabled={savingCheckin} onPress={() => void saveCheckin()}><Text style={styles.outlineText}>{savingCheckin ? 'Saving…' : 'Save daily signal'}</Text></Pressable></View>

        <View style={styles.captureCard}><Text style={styles.sectionTitle}>Quick capture</Text><Text style={styles.muted}>Save a task, doubt, note, or revision reminder in five seconds.</Text><View style={styles.captureKinds}>{(['TASK', 'DOUBT', 'REVISION', 'NOTE'] as CaptureKind[]).map((kind) => <Pressable key={kind} style={[styles.captureKind, captureKind === kind && styles.captureKindActive]} onPress={() => setCaptureKind(kind)}><Text style={[styles.captureKindText, captureKind === kind && styles.captureKindTextActive]}>{kind.charAt(0) + kind.slice(1).toLowerCase()}</Text></Pressable>)}</View><View style={styles.captureRow}><TextInput accessibilityLabel="Quick capture" value={capture} onChangeText={setCapture} placeholder={captureKind === 'DOUBT' ? 'e.g. Why does Article 356 require safeguards?' : captureKind === 'REVISION' ? 'e.g. Recall the Finance Commission’s role' : 'e.g. Revise Article 356 tomorrow'} style={styles.input} onSubmitEditing={() => void saveCapture()} /><Pressable disabled={savingCapture || !capture.trim()} style={[styles.captureButton, (!capture.trim() || savingCapture) && styles.disabled]} onPress={() => void saveCapture()}><Text style={styles.primaryText}>+</Text></Pressable></View></View>
    </ScrollView></Screen>;
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 36 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }, error: { color: '#b91c1c', textAlign: 'center' },
    hero: { backgroundColor: '#172554', borderRadius: 18, padding: 19, marginBottom: 13 }, eyebrow: { color: '#bfdbfe', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }, greeting: { color: '#fff', fontSize: 25, fontWeight: '800', marginTop: 8 }, exam: { color: '#dbeafe', marginTop: 4, fontWeight: '700' }, countdown: { color: '#fff', marginTop: 12, fontSize: 17, fontWeight: '800' },
    progressCard: { backgroundColor: '#eff6ff', borderRadius: 14, padding: 15, marginBottom: 18 }, progressTitle: { color: '#1e3a8a', fontWeight: '800' }, progressValue: { color: '#172554', fontSize: 22, fontWeight: '800', marginTop: 4 }, track: { height: 8, backgroundColor: '#dbeafe', borderRadius: 99, overflow: 'hidden', marginVertical: 9 }, fill: { height: '100%', backgroundColor: '#2563eb', borderRadius: 99 },
    sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }, sectionTitle: { color: '#111827', fontSize: 17, fontWeight: '800' }, link: { color: '#1d4ed8', fontWeight: '700' }, muted: { color: '#64748b', lineHeight: 19, marginTop: 4 },
    taskCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 14, marginBottom: 10 }, taskTop: { flexDirection: 'row', justifyContent: 'space-between' }, priority: { color: '#1d4ed8', fontSize: 10, letterSpacing: 0.7, fontWeight: '800' }, duration: { color: '#475569', fontWeight: '700' }, taskTitle: { color: '#0f172a', fontSize: 16, fontWeight: '800', marginTop: 7 }, taskMeta: { color: '#64748b', marginTop: 5, textTransform: 'capitalize' }, actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
    primary: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', marginTop: 12 }, primarySmall: { backgroundColor: '#2563eb', borderRadius: 9, paddingVertical: 10, paddingHorizontal: 12 }, primaryText: { color: '#fff', fontWeight: '800' }, outlineSmall: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 9, paddingVertical: 9, paddingHorizontal: 11 }, outlineText: { color: '#1d4ed8', fontWeight: '800' }, textButton: { padding: 8 },
    empty: { borderRadius: 14, padding: 16, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' }, emptyTitle: { color: '#0f172a', fontSize: 16, fontWeight: '800' }, briefingCard: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 }, briefingText: { color: '#1e3a8a', lineHeight: 21, fontWeight: '700', marginTop: 6, marginBottom: 8 }, revisionCard: { backgroundColor: '#f5f3ff', borderColor: '#ddd6fe', borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, currentCard: { backgroundColor: '#fff7ed', borderColor: '#fed7aa', borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 10 }, rescueCard: { backgroundColor: '#fefce8', borderColor: '#fde68a', borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14 }, wellbeingCard: { backgroundColor: '#f8fafc', borderColor: '#dbeafe', borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14 }, checkinLabel: { color: '#334155', fontWeight: '800', marginTop: 11 },
    captureCard: { marginTop: 18, borderRadius: 14, padding: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' }, captureKinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }, captureKind: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff' }, captureKindActive: { borderColor: '#2563eb', backgroundColor: '#eff6ff' }, captureKindText: { color: '#475569', fontSize: 12, fontWeight: '700' }, captureKindTextActive: { color: '#1d4ed8' }, captureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }, input: { flex: 1, backgroundColor: '#fff', borderColor: '#cbd5e1', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#0f172a' }, captureButton: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, backgroundColor: '#2563eb', borderRadius: 10 }, disabled: { opacity: 0.5 },
});
