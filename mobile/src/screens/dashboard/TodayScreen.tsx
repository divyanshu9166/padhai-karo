import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, getDailyQuiz, type DailyQuizResponse } from '@/api';
import { createDoubt, createResource, createRevisionCard, getDailyBriefing, saveWellbeing, type DailyBriefing } from '@/api/upscProduct';
import { Screen } from '@/components';
import { interpolate, useTranslation, type StringKey, type Translate } from '@/localization';
import type { MainTabScreenProps } from '@/navigation/types';

import { getToday, quickCapture, rescueBacklog, updateStudyTask, type StudyTask, type TaskType, type TodayResponse } from './todayApi';

type CaptureKind = 'TASK' | 'DOUBT' | 'REVISION' | 'NOTE';

const CAPTURE_LABELS: Record<CaptureKind, StringKey> = { TASK: 'today.captureTask', DOUBT: 'today.captureDoubt', REVISION: 'today.captureRevision', NOTE: 'today.captureNote' };
const CAPTURE_SAVED: Record<CaptureKind, StringKey> = { TASK: 'today.savedToInbox', DOUBT: 'today.savedToDoubts', REVISION: 'today.savedToRevision', NOTE: 'today.savedToLibrary' };
const ENERGY_LABELS: StringKey[] = ['today.energyLow', 'today.energyLowPlus', 'today.energyNormal', 'today.energyHigh', 'today.energyHighPlus'];
const STAGE_LABELS: Record<string, StringKey> = { PRELIMS: 'onboarding.stagePrelims', MAINS: 'onboarding.stageMains', TIER_1: 'onboarding.stageTier1', TIER_2: 'onboarding.stageTier2' };

function minutes(t: Translate, value: number): string {
    return value >= 60 ? interpolate(t('today.hoursMinutes'), { h: Math.floor(value / 60), m: value % 60 }) : interpolate(t('today.minutes'), { m: value });
}

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

function actionLabel(task: StudyTask): StringKey {
    if (task.taskType === 'REVISION') return 'today.startRevision';
    if (task.taskType === 'PYQ_PRACTICE' || task.taskType === 'QUANT_PRACTICE' || task.taskType === 'REASONING_PRACTICE') return 'today.startPractice';
    if (task.taskType === 'ANSWER_WRITING') return 'today.startWriting';
    return 'today.startFocus';
}

function greetingKey(hour: number): StringKey {
    return hour < 12 ? 'today.goodMorning' : hour < 17 ? 'today.goodAfternoon' : 'today.goodEvening';
}

/** Action-first home: shows the learner exactly what to do now, not a wall of statistics. */
export function TodayScreen({ navigation }: MainTabScreenProps<'Dashboard'>): React.JSX.Element {
    const t = useTranslation();
    const [data, setData] = useState<TodayResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [capture, setCapture] = useState('');
    const [captureKind, setCaptureKind] = useState<CaptureKind>('TASK');
    const [savingCapture, setSavingCapture] = useState(false);
    const [rescuing, setRescuing] = useState(false);
    const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
    const [quiz, setQuiz] = useState<DailyQuizResponse | null>(null);
    const [mood, setMood] = useState(3);
    const [energy, setEnergy] = useState(3);
    const [sleepHours, setSleepHours] = useState('7');
    const [savingCheckin, setSavingCheckin] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        try {
            setError(null);
            const [today, dailyBriefing, dailyQuiz] = await Promise.all([getToday(), getDailyBriefing().catch(() => null), getDailyQuiz().catch(() => null)]);
            setData(today);
            setBriefing(dailyBriefing?.briefing ?? null);
            setQuiz(dailyQuiz);
        }
        catch (caught) { setError(caught instanceof ApiError ? caught.message : t('today.loadError')); }
        finally { setLoading(false); }
    }, [t]);
    useEffect(() => { void load(); }, [load]);
    // Refresh the quiz card when returning from the quiz so the streak and score update.
    useEffect(() => navigation.addListener('focus', () => { void getDailyQuiz().then(setQuiz).catch(() => undefined); }), [navigation]);

    const complete = async (task: StudyTask): Promise<void> => {
        try {
            const { task: updated } = await updateStudyTask(task.id, { status: 'COMPLETED' });
            setData((previous) => {
                if (!previous) return previous;
                const wasCompleted = previous.tasks.find((item) => item.id === updated.id)?.status === 'COMPLETED';
                return {
                    ...previous,
                    tasks: previous.tasks.map((item) => item.id === updated.id ? updated : item),
                    // Read the prior task state from the updater's latest snapshot so rapid
                    // duplicate taps cannot increment the displayed count more than once.
                    progress: { ...previous.progress, completed: previous.progress.completed + (!wasCompleted && updated.status === 'COMPLETED' ? 1 : 0) },
                };
            });
        } catch (caught) { Alert.alert(t('today.completeError'), caught instanceof ApiError ? caught.message : t('today.tryAgainShort')); }
    };

    const startTask = async (task: StudyTask): Promise<void> => {
        try {
            const { task: updated } = task.status === 'PENDING' || task.status === 'MISSED'
                ? await updateStudyTask(task.id, { status: 'IN_PROGRESS' })
                : { task };
            navigation.navigate('Focus', { task: { id: updated.id, title: updated.title, subjectId: updated.subjectId, plannedMinutes: updated.plannedMinutes, sessionType: sessionType(updated.taskType) } });
        } catch (caught) { Alert.alert(t('today.startError'), caught instanceof ApiError ? caught.message : t('today.tryAgainShort')); }
    };

    const saveCapture = async (): Promise<void> => {
        if (!capture.trim()) return;
        setSavingCapture(true);
        try {
            const value = capture.trim();
            if (captureKind === 'DOUBT') await createDoubt({ title: value.slice(0, 90), question: value, tags: ['quick-capture'] });
            else if (captureKind === 'REVISION') await createRevisionCard({ title: value.slice(0, 90), prompt: value, answer: t('today.captureRevisionAnswer'), tags: ['quick-capture'] });
            else if (captureKind === 'NOTE') await createResource({ title: value, type: 'NOTE', tags: ['quick-capture', 'inbox'] });
            else await quickCapture(value);
            setCapture('');
            Alert.alert(t('today.captured'), t(CAPTURE_SAVED[captureKind]));
        }
        catch (caught) { Alert.alert(t('today.saveError'), caught instanceof ApiError ? caught.message : t('today.tryAgainShort')); }
        finally { setSavingCapture(false); }
    };

    const runRescue = async (input: { days?: 3 | 7; mode?: 'REDUCE_WORKLOAD' }): Promise<void> => {
        setRescuing(true);
        try {
            const result = await rescueBacklog(input);
            await load();
            const summary = interpolate(t('today.rescueSummary'), { rescued: result.rescued, days: result.days, time: minutes(t, result.dailyMinutes) });
            Alert.alert(t('today.rescueReady'), result.movedToInbox ? `${summary} ${interpolate(t('today.rescueMoved'), { count: result.movedToInbox })}` : summary);
        }
        catch (caught) { Alert.alert(t('today.rebalanceError'), caught instanceof ApiError ? caught.message : t('today.tryAgainShort')); }
        finally { setRescuing(false); }
    };
    const saveCheckin = async (): Promise<void> => {
        const sleep = Number(sleepHours);
        if (!Number.isFinite(sleep) || sleep < 0 || sleep > 24) { Alert.alert(t('today.checkSleep'), t('today.sleepRange')); return; }
        setSavingCheckin(true);
        try { await saveWellbeing({ mood, energy, stress: 6 - energy, sleepHours: sleep }); Alert.alert(t('today.signalSaved'), t('today.signalSavedText')); }
        catch (caught) { Alert.alert(t('today.saveError'), caught instanceof ApiError ? caught.message : t('today.tryAgainShort')); }
        finally { setSavingCheckin(false); }
    };

    if (loading && !data) return <Screen title={t('today.title')}><View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View></Screen>;
    if (!data) return <Screen title={t('today.title')}><View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable style={styles.primary} onPress={() => void load()}><Text style={styles.primaryText}>{t('common.retry')}</Text></Pressable></View></Screen>;

    const active = data.tasks.filter((task) => task.status !== 'COMPLETED');
    const stage = data.profile?.examStage ? t(STAGE_LABELS[data.profile.examStage] ?? 'onboarding.stagePrelims') : '';
    const aiBriefing = briefing?.insights.source === 'AI' && briefing.insights.ai?.keyPoints?.length;
    const capturePlaceholder = captureKind === 'DOUBT' ? t('today.capturePlaceholderDoubt') : captureKind === 'REVISION' ? t('today.capturePlaceholderRevision') : t('today.capturePlaceholderTask');
    return <Screen title={t('today.title')}><ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}>
        <View style={styles.hero}><Text style={styles.eyebrow}>{t('today.eyebrow')}</Text><Text style={styles.greeting}>{t(greetingKey(new Date().getHours()))}</Text><Text style={styles.exam}>{data.profile?.examProgram === 'SSC_CGL' ? t('onboarding.examSsc') : t('onboarding.examUpsc')} {stage}</Text><Text style={styles.countdown}>{data.countdownDays === null ? t('today.setExamDate') : interpolate(t('today.daysRemaining'), { count: data.countdownDays })}</Text></View>
        {briefing ? <View style={styles.briefingCard}><Text style={styles.priority}>{aiBriefing ? t('today.aiBriefing') : t('today.recommendation')}</Text><Text style={styles.briefingText}>{aiBriefing ? briefing.insights.ai!.keyPoints![0] : briefing.insights.actions[0] ?? briefing.insights.greeting}</Text><Pressable onPress={() => navigation.navigate('Plan')}><Text style={styles.link}>{t('today.seeFullPlan')}</Text></Pressable></View> : null}

        {quiz ? <View style={styles.quizCard}><View style={styles.taskTop}><Text style={styles.quizEyebrow}>{t('quiz.cardTitle')}</Text><Text style={styles.quizStreak}>🔥 {quiz.streak.current > 0 ? interpolate(t('quiz.streak'), { count: quiz.streak.current }) : t('quiz.streakStart')}</Text></View><Text style={styles.quizText}>{quiz.completed ? interpolate(t('quiz.cardDone'), { correct: quiz.completed.correctCount, total: quiz.completed.totalCount }) : quiz.available ? t('quiz.subtitle') : t('quiz.unavailableTitle')}</Text>{quiz.available || quiz.completed ? <Pressable style={styles.quizButton} onPress={() => navigation.navigate('Practice', { screen: 'DailyQuiz' })}><Text style={styles.quizButtonText}>{quiz.completed ? t('quiz.review') : t('quiz.start')}</Text></Pressable> : null}</View> : null}

        <View style={styles.progressCard}><Text style={styles.progressTitle}>{t('today.progressTitle')}</Text><Text style={styles.progressValue}>{interpolate(t('today.tasksCompleted'), { completed: data.progress.completed, total: data.progress.total })}</Text><View style={styles.track}><View style={[styles.fill, { width: `${data.progress.total ? Math.min(100, data.progress.completed / data.progress.total * 100) : 0}%` }]} /></View><Text style={styles.muted}>{interpolate(t('today.focusedSoFar'), { time: minutes(t, data.progress.focusedMinutes) })}</Text></View>

        <View style={styles.sectionRow}><Text style={styles.sectionTitle}>{t('today.planTitle')}</Text><Pressable onPress={() => navigation.navigate('Plan')}><Text style={styles.link}>{t('today.openPlan')}</Text></Pressable></View>
        {active.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>{t('today.planClearTitle')}</Text><Text style={styles.muted}>{t('today.planClearText')}</Text><Pressable style={styles.primary} onPress={() => navigation.navigate('Plan')}><Text style={styles.primaryText}>{t('today.buildPlan')}</Text></Pressable></View> : active.slice(0, 5).map((task, index) => <View key={task.id} style={styles.taskCard}><View style={styles.taskTop}><Text style={styles.priority}>{interpolate(t('today.priority'), { n: index + 1 })}{task.priority === 'CRITICAL' ? ` · ${t('today.urgent')}` : ''}</Text><Text style={styles.duration}>{minutes(t, task.plannedMinutes)}</Text></View><Text style={styles.taskTitle}>{task.title}</Text><Text style={styles.taskMeta}>{t(`taskType.${task.taskType}` as StringKey)}{task.syllabusUnit ? ` · ${task.syllabusUnit}` : ''}</Text><View style={styles.actions}><Pressable style={styles.primarySmall} onPress={() => void startTask(task)}><Text style={styles.primaryText}>{t(actionLabel(task))}</Text></Pressable><Pressable style={styles.outlineSmall} onPress={() => void complete(task)}><Text style={styles.outlineText}>{t('today.markDone')}</Text></Pressable></View></View>)}

        <View style={styles.revisionCard}><View style={styles.grow}><Text style={styles.sectionTitle}>{t('today.revisionDueTitle')}</Text><Text style={styles.muted}>{interpolate(t('today.revisionDueText'), { count: data.revisionDue })}</Text></View><Pressable style={styles.outlineSmall} onPress={() => navigation.navigate('More', { screen: 'RecallStudio' })}><Text style={styles.outlineText}>{t('today.startRevision')}</Text></Pressable></View>
        {data.currentAffairs ? <View style={styles.currentCard}><Text style={styles.priority}>{t('today.currentAffairsLabel')}</Text><Text style={styles.taskTitle}>{data.currentAffairs.title}</Text><Text style={styles.taskMeta}>{data.currentAffairs.syllabusTags.join(' · ') || data.currentAffairs.category}</Text><Pressable style={styles.outlineSmall} onPress={() => navigation.navigate('More', { screen: 'Updates' })}><Text style={styles.outlineText}>{t('today.readAndSave')}</Text></Pressable></View> : null}

        {data.backlogCount > 0 ? <View style={styles.rescueCard}><Text style={styles.sectionTitle}>{t('today.backlogTitle')}</Text><Text style={styles.muted}>{interpolate(t('today.backlogText'), { count: data.backlogCount })}</Text><View style={styles.actions}><Pressable disabled={rescuing} style={styles.primarySmall} onPress={() => void runRescue({ days: 3 })}><Text style={styles.primaryText}>{t('today.recover3')}</Text></Pressable><Pressable disabled={rescuing} style={styles.outlineSmall} onPress={() => void runRescue({ days: 7 })}><Text style={styles.outlineText}>{t('today.recover7')}</Text></Pressable><Pressable disabled={rescuing} style={styles.textButton} onPress={() => void runRescue({ mode: 'REDUCE_WORKLOAD' })}><Text style={styles.link}>{t('today.reduceWorkload')}</Text></Pressable></View></View> : null}

        <View style={styles.wellbeingCard}><Text style={styles.sectionTitle}>{t('today.energyTitle')}</Text><Text style={styles.muted}>{t('today.energyText')}</Text><Text style={styles.checkinLabel}>{t('today.mood')}</Text><View style={styles.captureKinds}>{([1, 2, 3, 4, 5]).map((value) => <Pressable key={value} style={[styles.captureKind, mood === value && styles.captureKindActive]} onPress={() => setMood(value)}><Text style={[styles.captureKindText, mood === value && styles.captureKindTextActive]}>{['😞', '😕', '😐', '🙂', '😄'][value - 1]}</Text></Pressable>)}</View><Text style={styles.checkinLabel}>{t('today.energy')}</Text><View style={styles.captureKinds}>{([1, 2, 3, 4, 5]).map((value) => <Pressable key={value} style={[styles.captureKind, energy === value && styles.captureKindActive]} onPress={() => setEnergy(value)}><Text style={[styles.captureKindText, energy === value && styles.captureKindTextActive]}>{t(ENERGY_LABELS[value - 1]!)}</Text></Pressable>)}</View><TextInput style={styles.input} value={sleepHours} onChangeText={setSleepHours} keyboardType="decimal-pad" placeholder={t('today.sleepHours')} accessibilityLabel={t('today.sleepHours')} /><Pressable style={styles.outlineSmall} disabled={savingCheckin} onPress={() => void saveCheckin()}><Text style={styles.outlineText}>{savingCheckin ? t('today.saving') : t('today.saveSignal')}</Text></Pressable></View>

        <View style={styles.captureCard}><Text style={styles.sectionTitle}>{t('today.captureTitle')}</Text><Text style={styles.muted}>{t('today.captureText')}</Text><View style={styles.captureKinds}>{(['TASK', 'DOUBT', 'REVISION', 'NOTE'] as CaptureKind[]).map((kind) => <Pressable key={kind} style={[styles.captureKind, captureKind === kind && styles.captureKindActive]} onPress={() => setCaptureKind(kind)}><Text style={[styles.captureKindText, captureKind === kind && styles.captureKindTextActive]}>{t(CAPTURE_LABELS[kind])}</Text></Pressable>)}</View><View style={styles.captureRow}><TextInput accessibilityLabel={t('today.captureA11y')} value={capture} onChangeText={setCapture} placeholder={capturePlaceholder} style={styles.input} onSubmitEditing={() => void saveCapture()} /><Pressable disabled={savingCapture || !capture.trim()} style={[styles.captureButton, (!capture.trim() || savingCapture) && styles.disabled]} onPress={() => void saveCapture()}><Text style={styles.primaryText}>+</Text></Pressable></View></View>
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
    quizCard: { backgroundColor: '#fff7ed', borderColor: '#fed7aa', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 }, quizEyebrow: { color: '#9a3412', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' }, quizStreak: { color: '#9a3412', fontWeight: '800' }, quizText: { color: '#431407', marginTop: 6, lineHeight: 20 }, quizButton: { alignSelf: 'flex-start', backgroundColor: '#ea580c', borderRadius: 9, paddingVertical: 10, paddingHorizontal: 14, marginTop: 10 }, quizButtonText: { color: '#fff', fontWeight: '800' }, grow: { flex: 1 },
});
