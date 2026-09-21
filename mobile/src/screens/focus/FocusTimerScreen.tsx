/**
 * Focus timer screen (task 21.4; Req 4.1, 4.2, 4.4, 4.6).
 *
 * A Pomodoro-style on-device timer that excludes paused time from the focused duration
 * (Req 4.2, via the pure `timing` state machine), requires a subject before starting
 * (Req 4.4/4.6), lets the user tag a Session_Type (Req 4.6), and records the session via
 * `POST /focus-sessions` on stop. Timing is local; the Backend_API validates and persists.
 *
 * Reconstructed during scaffold recovery; composes the surviving focus `timing`,
 * `sessionTypes`, and `api` modules.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { ApiError, type LocalSyncRecord } from '@/api';
import { getAmbientModes, type AmbientMode } from '@/api/upscProduct';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import type { MainTabScreenProps } from '@/navigation/types';
import { OfflineBanner, useOffline } from '@/offline';
import { queueMutation } from '@/offline/mutations';
import { updateStudyTask } from '@/screens/dashboard/todayApi';

import {
    fetchFocusSetup,
    generateClientId,
    recordFocusSession,
    type SubjectOption,
} from './api';
import { DEFAULT_SESSION_TYPE, SESSION_TYPE_OPTIONS, type SessionType } from './sessionTypes';
import {
    createTimer,
    focusedMinutes,
    focusedMs,
    formatDuration,
    pause,
    resume,
    start,
    stop,
    type TimerState,
} from './timing';
import { scheduleFocusBreakReminder } from '@/notifications/reminders';

export function FocusTimerScreen({ route }: MainTabScreenProps<'Focus'>): React.JSX.Element {
    const t = useTranslation();
    // The timer runs locally; while offline the recorded session is queued for sync (Req 21.3).
    const { isOffline, enqueueRecord } = useOffline();

    const [subjects, setSubjects] = useState<SubjectOption[]>([]);
    const [subjectsError, setSubjectsError] = useState<string | null>(null);
    const [subjectId, setSubjectId] = useState<string | null>(null);
    const [sessionType, setSessionType] = useState<SessionType>(DEFAULT_SESSION_TYPE);
    const [examSelection, setExamSelection] = useState<{ examProgram?: string | null; examStage?: string | null } | null>(null);
    const activeTask = route.params?.task;

    const [timer, setTimer] = useState<TimerState>(() => createTimer());
    const [, setTick] = useState(0); // force re-render once per second while running
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [finishPrompt, setFinishPrompt] = useState<{ id: string; title: string; minutes: number } | null>(null);
    const [ambientModes, setAmbientModes] = useState<AmbientMode[]>([]);
    const [selectedAmbientId, setSelectedAmbientId] = useState<string | null>(null);
    const [ambientMessage, setAmbientMessage] = useState<string | null>(null);

    const mounted = useRef(true);
    const breakReminderId = useRef<string | null>(null);
    const breakReminderGeneration = useRef(0);
    const ambientSound = useRef<Audio.Sound | null>(null);

    const stopAmbient = useCallback(async (): Promise<void> => {
        const sound = ambientSound.current;
        ambientSound.current = null;
        if (sound) await sound.unloadAsync().catch(() => undefined);
    }, []);
    const pauseAmbient = useCallback(async (): Promise<void> => {
        if (ambientSound.current) await ambientSound.current.pauseAsync().catch(() => undefined);
    }, []);
    const resumeAmbient = useCallback(async (): Promise<void> => {
        if (ambientSound.current) await ambientSound.current.playAsync().catch(() => undefined);
    }, []);
    const startAmbient = useCallback(async (): Promise<void> => {
        const mode = ambientModes.find((item) => item.id === selectedAmbientId);
        if (!mode?.url) return;
        await stopAmbient();
        try {
            const created = await Audio.Sound.createAsync({ uri: mode.url }, { shouldPlay: true, isLooping: mode.loop });
            ambientSound.current = created.sound;
            if (mounted.current) setAmbientMessage(`${mode.label} ${t('focus.ambientPlaying')}`);
        } catch {
            if (mounted.current) setAmbientMessage(t('focus.ambientUnavailable'));
        }
    }, [ambientModes, selectedAmbientId, stopAmbient, t]);

    const cancelBreakReminder = useCallback((): void => {
        breakReminderGeneration.current += 1;
        const reminderId = breakReminderId.current;
        breakReminderId.current = null;
        if (reminderId) void Notifications.cancelScheduledNotificationAsync(reminderId).catch(() => undefined);
    }, []);

    const scheduleBreakReminder = useCallback((): void => {
        const generation = ++breakReminderGeneration.current;
        void scheduleFocusBreakReminder().then((id) => {
            if (generation === breakReminderGeneration.current) breakReminderId.current = id;
            else void Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
        }).catch(() => undefined);
    }, []);

    useEffect(() => {
        mounted.current = true;
        (async () => {
            try {
                const setup = await fetchFocusSetup();
                if (mounted.current) {
                    setSubjects(setup.subjects);
                    setExamSelection(setup.selection);
                }
            } catch (err) {
                if (mounted.current) {
                    setSubjectsError(
                        err instanceof ApiError ? err.message : t('focus.loadSubjectsError'),
                    );
                }
            }
            try {
                const result = await getAmbientModes();
                if (mounted.current) setAmbientModes(result.modes.filter((mode) => Boolean(mode.url)));
            } catch {
                // Ambient sound is optional; never block the timer if a provider is unavailable.
            }
        })();
        return () => {
            mounted.current = false;
            void stopAmbient();
        };
    }, [stopAmbient]);

    useEffect(() => {
        if (!activeTask || timer.status !== 'idle') return;
        setSubjectId(activeTask.subjectId ?? null);
        setSessionType(activeTask.sessionType);
        setMessage(`Ready to focus: ${activeTask.title}`);
    }, [activeTask, timer.status]);

    // Tick the display each second while running.
    useEffect(() => {
        if (timer.status !== 'running') {
            return undefined;
        }
        const interval = setInterval(() => setTick((n) => n + 1), 1000);
        return () => clearInterval(interval);
    }, [timer.status]);

    const onStart = (): void => {
        if (!subjectId) {
            setMessage(t('focus.selectSubject'));
            return;
        }
        setMessage(null);
        setTimer((prev) => start(prev, Date.now()));
        scheduleBreakReminder();
        void startAmbient();
    };

    const onPause = (): void => { cancelBreakReminder(); setTimer((prev) => pause(prev, Date.now())); void pauseAmbient(); };
    const onResume = (): void => { setTimer((prev) => resume(prev, Date.now())); scheduleBreakReminder(); void resumeAmbient(); };

    const onStop = useCallback(async (): Promise<void> => {
        const now = Date.now();
        const stopped = stop(timer, now);
        cancelBreakReminder();
        void stopAmbient();
        setTimer(createTimer());
        if (!stopped || !subjectId) {
            return;
        }
        const abandoned = stopped.focusedMinutes <= 0;
        setSaving(true);
        try {
            const clientId = generateClientId();
            const startTime = new Date(stopped.startedAt).toISOString();
            const endTime = new Date(stopped.endedAt).toISOString();
            if (isOffline) {
                // Offline: queue the session as a Local_Sync_Record; it syncs on reconnect.
                const record: LocalSyncRecord = {
                    clientId,
                    type: 'FOCUS_SESSION',
                    payload: {
                        subjectId,
                        startTime,
                        endTime,
                        focusedDurationMin: stopped.focusedMinutes,
                        abandoned,
                        sessionType,
                        taskId: activeTask?.id,
                    },
                };
                await enqueueRecord(record);
                setMessage(`${stopped.focusedMinutes} min ${t('focus.savedOffline')}`);
            } else {
                await recordFocusSession({
                    subjectId,
                    startTime,
                    endTime,
                    focusedDurationMin: stopped.focusedMinutes,
                    abandoned,
                    sessionType,
                    taskId: activeTask?.id,
                    clientId,
                });
                setMessage(abandoned ? t('focus.sessionAbandoned') : `${t('focus.recorded')} ${stopped.focusedMinutes} min`);
            }
            if (activeTask && !abandoned) setFinishPrompt({ id: activeTask.id, title: activeTask.title, minutes: stopped.focusedMinutes });
        } catch (err) {
            setMessage(err instanceof ApiError ? err.message : t('focus.recordError'));
        } finally {
            if (mounted.current) {
                setSaving(false);
            }
        }
    }, [timer, subjectId, sessionType, activeTask, isOffline, enqueueRecord, cancelBreakReminder, stopAmbient]);

    const completeLinkedTask = async (): Promise<void> => {
        if (!finishPrompt) return;
        setSaving(true);
        try {
            if (isOffline) await queueMutation('STUDY_TASK_UPDATE', { id: finishPrompt.id, status: 'COMPLETED' });
            else await updateStudyTask(finishPrompt.id, { status: 'COMPLETED' });
            setMessage(`${finishPrompt.title} marked complete.`);
            setFinishPrompt(null);
        } catch (error) { setMessage(error instanceof ApiError ? error.message : 'Could not update this task.'); }
        finally { if (mounted.current) setSaving(false); }
    };

    const elapsedMs = focusedMs(timer, Date.now());
    const minutes = focusedMinutes(timer, Date.now());
    const relevantSessionTypes = SESSION_TYPE_OPTIONS.filter((option) => {
        if (examSelection?.examProgram === 'SSC_CGL') {
            return [
                'NEW_CHAPTER', 'NOTES_MAKING', 'PRACTICE_PROBLEMS', 'REVISION', 'MOCK_TEST', 'MOCK_ANALYSIS',
                'QUANT_PRACTICE', 'REASONING_PRACTICE', 'VOCABULARY', 'FORMULA_DRILL',
            ].includes(option.value);
        }
        if (examSelection?.examProgram === 'UPSC_CSE') {
            const common = ['NEW_CHAPTER', 'NOTES_MAKING', 'REVISION', 'MOCK_TEST', 'MOCK_ANALYSIS', 'CURRENT_AFFAIRS'];
            const stageSpecific = examSelection.examStage === 'MAINS'
                ? ['ANSWER_WRITING']
                : ['PRACTICE_PROBLEMS'];
            return [...common, ...stageSpecific].includes(option.value);
        }
        return true;
    });

    return (
        <Screen title={t('focus.title')}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <OfflineBanner />
                <View style={styles.clockCard}>
                    <Text style={styles.clock}>{formatDuration(elapsedMs)}</Text>
                    <Text style={styles.clockMeta}>{minutes} {t('focus.focusedMinutes')}</Text>
                </View>

                <Text style={styles.label}>{t('focus.selectSubject')}</Text>
                {subjectsError ? <Text style={styles.error}>{subjectsError}</Text> : null}
                <View style={styles.chipRow}>
                    {subjects.map((s) => (
                        <Pressable
                            key={s.id}
                            onPress={() => setSubjectId(s.id)}
                            disabled={timer.status !== 'idle'}
                            style={[styles.chip, subjectId === s.id && styles.chipSelected]}
                        >
                            <Text
                                style={[
                                    styles.chipText,
                                    subjectId === s.id && styles.chipTextSelected,
                                ]}
                            >
                                {s.name}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                <Text style={styles.label}>{t('focus.sessionType')}</Text>
                <View style={styles.chipRow}>
                    {relevantSessionTypes.map((option) => (
                        <Pressable
                            key={option.value}
                            onPress={() => setSessionType(option.value)}
                            style={[styles.chip, sessionType === option.value && styles.chipSelected]}
                        >
                            <Text
                                style={[
                                    styles.chipText,
                                    sessionType === option.value && styles.chipTextSelected,
                                ]}
                            >
                                {option.labelKey ? t(option.labelKey) : option.fallbackLabel}
                            </Text>
                        </Pressable>
                    ))}
                </View>
                {activeTask ? <View style={styles.taskCard}><Text style={styles.taskEyebrow}>CURRENT TASK</Text><Text style={styles.taskTitle}>{activeTask.title}</Text><Text style={styles.taskMeta}>{activeTask.plannedMinutes} min planned</Text></View> : null}

                {ambientModes.length > 0 ? <>
                    <Text style={styles.label}>{t('focus.ambientLabel')}</Text>
                    <View style={styles.chipRow}>
                        <Pressable
                            onPress={() => setSelectedAmbientId(null)}
                            disabled={timer.status !== 'idle'}
                            style={[styles.chip, selectedAmbientId === null && styles.chipSelected]}
                        ><Text style={[styles.chipText, selectedAmbientId === null && styles.chipTextSelected]}>{t('focus.ambientNone')}</Text></Pressable>
                        {ambientModes.map((mode) => <Pressable
                            key={mode.id}
                            onPress={() => setSelectedAmbientId(mode.id)}
                            disabled={timer.status !== 'idle'}
                            style={[styles.chip, selectedAmbientId === mode.id && styles.chipSelected]}
                        ><Text style={[styles.chipText, selectedAmbientId === mode.id && styles.chipTextSelected]}>{mode.label}</Text></Pressable>)}
                    </View>
                    {ambientMessage ? <Text style={styles.ambientMessage}>{ambientMessage}</Text> : null}
                </> : null}

                {message ? <Text style={styles.message}>{message}</Text> : null}
                {finishPrompt ? <View style={styles.finishCard}><Text style={styles.taskEyebrow}>SESSION COMPLETE</Text><Text style={styles.taskTitle}>{finishPrompt.minutes} min of focus logged for {finishPrompt.title}</Text><Text style={styles.taskMeta}>Did you finish the planned task?</Text><View style={styles.finishActions}><PrimaryButton label="Mark task complete" onPress={() => void completeLinkedTask()} busy={saving} /><Pressable style={styles.continueButton} onPress={() => setFinishPrompt(null)} disabled={saving}><Text style={styles.continueText}>Continue later</Text></Pressable></View></View> : null}

                <View style={styles.controls}>
                    {timer.status === 'idle' ? (
                        <PrimaryButton label={t('focus.start')} onPress={onStart} />
                    ) : null}
                    {timer.status === 'running' ? (
                        <PrimaryButton label={t('focus.pause')} onPress={onPause} />
                    ) : null}
                    {timer.status === 'paused' ? (
                        <PrimaryButton label={t('focus.start')} onPress={onResume} />
                    ) : null}
                    {timer.status !== 'idle' ? (
                        <PrimaryButton
                            label={t('focus.stop')}
                            onPress={() => void onStop()}
                            busy={saving}
                            variant="danger"
                        />
                    ) : null}
                </View>
            </ScrollView>
        </Screen>
    );
}

function PrimaryButton({
    label,
    onPress,
    busy = false,
    variant = 'primary',
}: {
    label: string;
    onPress: () => void;
    busy?: boolean;
    variant?: 'primary' | 'danger';
}): React.JSX.Element {
    return (
        <Pressable
            onPress={onPress}
            disabled={busy}
            accessibilityRole="button"
            style={[
                styles.button,
                variant === 'danger' ? styles.buttonDanger : styles.buttonPrimary,
                busy && styles.disabled,
            ]}
        >
            {busy ? (
                <ActivityIndicator color="#ffffff" />
            ) : (
                <Text style={styles.buttonText}>{label}</Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 },
    clockCard: {
        alignItems: 'center',
        paddingVertical: 28,
        backgroundColor: '#eff6ff',
        borderRadius: 16,
        marginBottom: 20,
    },
    clock: {
        fontSize: 48,
        fontWeight: '800',
        color: '#1d4ed8',
        fontVariant: ['tabular-nums'],
    },
    clockMeta: { marginTop: 6, fontSize: 14, color: '#475569' },
    taskCard: { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0', borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 8 },
    taskEyebrow: { color: '#047857', fontWeight: '800', fontSize: 11, letterSpacing: 0.6 },
    taskTitle: { color: '#064e3b', fontWeight: '800', fontSize: 16, marginTop: 3 },
    taskMeta: { color: '#047857', marginTop: 3 },
    finishCard: { backgroundColor: '#f0fdf4', borderColor: '#86efac', borderWidth: 1, borderRadius: 12, padding: 13, marginTop: 12 },
    finishActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 11 },
    continueButton: { padding: 9 },
    continueText: { color: '#1d4ed8', fontWeight: '800' },
    label: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 8 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
    chip: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 8,
        marginRight: 8,
        marginBottom: 8,
    },
    chipSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    chipText: { fontSize: 14, color: '#374151' },
    chipTextSelected: { color: '#ffffff', fontWeight: '600' },
    message: { marginTop: 12, fontSize: 14, color: '#374151' },
    ambientMessage: { marginTop: 2, fontSize: 12, color: '#475569', lineHeight: 18 },
    error: { color: '#dc2626', fontSize: 14, marginBottom: 8 },
    controls: { marginTop: 20 },
    button: {
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: 'center',
        marginBottom: 10,
        minHeight: 48,
        justifyContent: 'center',
    },
    buttonPrimary: { backgroundColor: '#2563eb' },
    buttonDanger: { backgroundColor: '#dc2626' },
    buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
    disabled: { opacity: 0.6 },
});
