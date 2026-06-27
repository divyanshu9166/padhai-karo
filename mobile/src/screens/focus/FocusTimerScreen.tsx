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
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { ApiError, type LocalSyncRecord } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import { OfflineBanner, useOffline } from '@/offline';

import {
    fetchSubjectOptions,
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

export function FocusTimerScreen(): React.JSX.Element {
    const t = useTranslation();
    // The timer runs locally; while offline the recorded session is queued for sync (Req 21.3).
    const { isOffline, enqueueRecord } = useOffline();

    const [subjects, setSubjects] = useState<SubjectOption[]>([]);
    const [subjectsError, setSubjectsError] = useState<string | null>(null);
    const [subjectId, setSubjectId] = useState<string | null>(null);
    const [sessionType, setSessionType] = useState<SessionType>(DEFAULT_SESSION_TYPE);

    const [timer, setTimer] = useState<TimerState>(() => createTimer());
    const [, setTick] = useState(0); // force re-render once per second while running
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        (async () => {
            try {
                const options = await fetchSubjectOptions();
                if (mounted.current) {
                    setSubjects(options);
                }
            } catch (err) {
                if (mounted.current) {
                    setSubjectsError(
                        err instanceof ApiError ? err.message : 'Could not load subjects.',
                    );
                }
            }
        })();
        return () => {
            mounted.current = false;
        };
    }, []);

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
    };

    const onPause = (): void => setTimer((prev) => pause(prev, Date.now()));
    const onResume = (): void => setTimer((prev) => resume(prev, Date.now()));

    const onStop = useCallback(async (): Promise<void> => {
        const now = Date.now();
        const stopped = stop(timer, now);
        setTimer(createTimer());
        if (!stopped || !subjectId) {
            return;
        }
        if (stopped.focusedMinutes <= 0) {
            setMessage('Focused time was under a minute — nothing recorded.');
            return;
        }
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
                        sessionType,
                    },
                };
                await enqueueRecord(record);
                setMessage(`Saved ${stopped.focusedMinutes} min offline — will sync when you reconnect.`);
            } else {
                await recordFocusSession({
                    subjectId,
                    startTime,
                    endTime,
                    focusedDurationMin: stopped.focusedMinutes,
                    sessionType,
                    clientId,
                });
                setMessage(`Recorded ${stopped.focusedMinutes} min.`);
            }
        } catch (err) {
            setMessage(err instanceof ApiError ? err.message : 'Could not record the session.');
        } finally {
            if (mounted.current) {
                setSaving(false);
            }
        }
    }, [timer, subjectId, sessionType, isOffline, enqueueRecord]);

    const elapsedMs = focusedMs(timer, Date.now());
    const minutes = focusedMinutes(timer, Date.now());

    return (
        <Screen title={t('focus.title')}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <OfflineBanner />
                <View style={styles.clockCard}>
                    <Text style={styles.clock}>{formatDuration(elapsedMs)}</Text>
                    <Text style={styles.clockMeta}>{minutes} focused min</Text>
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

                <Text style={styles.label}>Session type</Text>
                <View style={styles.chipRow}>
                    {SESSION_TYPE_OPTIONS.map((option) => (
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

                {message ? <Text style={styles.message}>{message}</Text> : null}

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
