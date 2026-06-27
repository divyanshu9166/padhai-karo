/**
 * Timed Paper Mode screen (task 21.6; Req 19.1–19.4).
 *
 * Loads a paper (GET /papers/:id) with its standard duration and answer-less questions, then
 * runs a live countdown for that duration over an editable answer sheet. The attempt is
 * submitted (POST /timed-attempts) either manually or automatically the moment the countdown
 * reaches zero, recording the elapsed `timeTakenSec`; the result view then shows instant
 * per-question scoring and lets the user flag wrong/unreached questions into the journal.
 *
 * A paper id can arrive via the route (`TimedPaper` params) or be entered on the screen, since
 * Phase 1 has no paper-listing endpoint.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { ApiError, type LocalSyncRecord, type PaperBundle } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import type { PracticeStackScreenProps } from '@/navigation/types';
import { OfflineBanner, generateClientId, getDownload, scoreBundle, useOffline } from '@/offline';

import {
    getPaper,
    submitTimedAttempt,
    type AttemptResult,
    type ClientPYQ,
    type PaperResponse,
} from './api';
import { AttemptResults } from './components/AttemptResults';
import { QuestionCard } from './components/QuestionCard';
import { elapsedSec, formatClock, initialRemainingSec, isExpired, tick } from './countdown';

type Phase =
    | { kind: 'enterId' }
    | { kind: 'loadingPaper' }
    | { kind: 'error'; message: string }
    | { kind: 'running'; paper: PaperResponse }
    | { kind: 'submitting'; paper: PaperResponse }
    | { kind: 'results'; paper: PaperResponse; result: AttemptResult };

/** Adapt a downloaded {@link PaperBundle} into the on-screen {@link PaperResponse} shape. */
function bundleToPaper(bundle: PaperBundle): PaperResponse {
    return {
        paper: {
            id: bundle.paper.id,
            examTrack: bundle.paper.examTrack as 'JEE' | 'NEET',
            year: bundle.paper.year,
            session: bundle.paper.session ?? '',
        },
        durationMin: bundle.paper.durationMin,
        questions: bundle.paper.questions.map((q) => ({
            id: q.id,
            questionText: q.questionText,
            options: q.options,
        })),
    };
}

export function TimedPaperScreen({
    route,
}: PracticeStackScreenProps<'TimedPaper'>): React.JSX.Element {
    const t = useTranslation();
    const routePaperId = route.params?.paperId;
    // Offline support: download bundles, serve them offline, and queue attempts (Req 21.1–21.3).
    const { isOffline, downloadPaper, enqueueRecord } = useOffline();

    const [paperIdText, setPaperIdText] = useState(routePaperId ?? '');
    const [phase, setPhase] = useState<Phase>({ kind: 'enterId' });
    const [answers, setAnswers] = useState<Record<string, number | null>>({});
    const [remainingSec, setRemainingSec] = useState(0);
    const [formError, setFormError] = useState<string | null>(null);
    const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

    // The downloaded bundle backing an offline attempt (null when taking a paper online); kept
    // so the attempt can be scored locally and queued for sync on submit.
    const offlineBundleRef = useRef<PaperBundle | null>(null);

    // Guards a single submission so the manual button and the auto-submit-at-zero effect
    // never both fire for the same attempt.
    const submittedRef = useRef(false);

    const startPaper = useCallback(
        async (paperId: string): Promise<void> => {
            const id = paperId.trim();
            if (id === '') {
                setFormError('Enter a paper id to begin.');
                return;
            }
            setFormError(null);
            setPhase({ kind: 'loadingPaper' });

            // Start a downloaded paper from the on-device store (used offline, or as a fallback
            // when the network fetch fails). Returns true when a cached bundle was found.
            const startFromCache = async (): Promise<boolean> => {
                const download = await getDownload(id);
                if (!download) {
                    return false;
                }
                submittedRef.current = false;
                offlineBundleRef.current = download.bundle;
                setAnswers({});
                setRemainingSec(initialRemainingSec(download.bundle.paper.durationMin));
                setPhase({ kind: 'running', paper: bundleToPaper(download.bundle) });
                return true;
            };

            // Offline: only downloaded papers are available (Req 21.2).
            if (isOffline) {
                if (!(await startFromCache())) {
                    setPhase({
                        kind: 'error',
                        message:
                            "You're offline and this paper isn't downloaded. Download it while online to take it offline.",
                    });
                }
                return;
            }

            try {
                const paper = await getPaper(id);
                submittedRef.current = false;
                offlineBundleRef.current = null;
                setAnswers({});
                setRemainingSec(initialRemainingSec(paper.durationMin));
                setPhase({ kind: 'running', paper });
            } catch (err) {
                // Network failed — fall back to a downloaded copy when one exists.
                if (await startFromCache()) {
                    return;
                }
                const message =
                    err instanceof ApiError ? err.message : 'Could not load the paper. Try again.';
                setPhase({ kind: 'error', message });
            }
        },
        [isOffline],
    );

    const onDownload = useCallback(async (): Promise<void> => {
        const id = paperIdText.trim();
        if (id === '') {
            setFormError('Enter a paper id to download.');
            return;
        }
        setFormError(null);
        setDownloadMsg('Downloading…');
        try {
            await downloadPaper(id);
            setDownloadMsg('Downloaded — available offline.');
        } catch (err) {
            setDownloadMsg(null);
            setFormError(
                err instanceof ApiError ? err.message : 'Could not download this paper. Try again.',
            );
        }
    }, [paperIdText, downloadPaper]);

    // Auto-start when a paper id was provided via the route.
    useEffect(() => {
        if (routePaperId && routePaperId.trim() !== '') {
            void startPaper(routePaperId);
        }
    }, [routePaperId, startPaper]);

    const questionsById = useMemo<Record<string, ClientPYQ>>(() => {
        const map: Record<string, ClientPYQ> = {};
        if (phase.kind === 'running' || phase.kind === 'submitting' || phase.kind === 'results') {
            for (const q of phase.paper.questions) map[q.id] = q;
        }
        return map;
    }, [phase]);

    const doSubmit = useCallback(
        async (paper: PaperResponse): Promise<void> => {
            if (submittedRef.current) return;
            submittedRef.current = true;

            const timeTakenSec = elapsedSec(paper.durationMin, remainingSec);
            const answerList = paper.questions.map((q) => ({
                questionId: q.id,
                selectedOption: answers[q.id] ?? null,
            }));

            setPhase({ kind: 'submitting', paper });

            // Offline: score locally from the downloaded bundle and queue the attempt as a
            // Local_Sync_Record; the canonical score is recomputed server-side on sync (Req 21.3/21.5).
            const bundle = offlineBundleRef.current;
            if (isOffline && bundle) {
                const local = scoreBundle(bundle, answers);
                const clientId = generateClientId();
                const record: LocalSyncRecord = {
                    clientId,
                    type: 'TIMED_PAPER_ATTEMPT',
                    payload: { paperId: paper.paper.id, answers: answerList, timeTakenSec },
                };
                try {
                    await enqueueRecord(record);
                } catch {
                    // A queue write failure shouldn't lose the user's local result; show it anyway.
                }
                setPhase({
                    kind: 'results',
                    paper,
                    result: {
                        attemptId: `local:${clientId}`,
                        totalScore: local.totalScore,
                        perQuestion: local.perQuestion,
                    },
                });
                return;
            }

            try {
                const result = await submitTimedAttempt({
                    paperId: paper.paper.id,
                    answers: answerList,
                    timeTakenSec,
                });
                setPhase({ kind: 'results', paper, result });
            } catch (err) {
                const message =
                    err instanceof ApiError ? err.message : 'Could not submit the paper. Try again.';
                submittedRef.current = false;
                setFormError(message);
                setPhase({ kind: 'running', paper });
            }
        },
        [answers, remainingSec, isOffline, enqueueRecord],
    );

    // Tick the countdown once per second while the paper is running.
    useEffect(() => {
        if (phase.kind !== 'running') return undefined;
        const interval = setInterval(() => {
            setRemainingSec((prev) => tick(prev));
        }, 1000);
        return () => clearInterval(interval);
    }, [phase.kind]);

    // Auto-submit the instant the countdown reaches zero (Req 19.3).
    useEffect(() => {
        if (phase.kind === 'running' && isExpired(remainingSec)) {
            void doSubmit(phase.paper);
        }
    }, [phase, remainingSec, doSubmit]);

    const resetToEntry = (): void => {
        submittedRef.current = false;
        offlineBundleRef.current = null;
        setAnswers({});
        setRemainingSec(0);
        setFormError(null);
        setDownloadMsg(null);
        setPhase({ kind: 'enterId' });
    };

    return (
        <Screen title="Timed paper">
            {phase.kind === 'loadingPaper' ? (
                <Centered>
                    <ActivityIndicator size="large" color="#2563eb" />
                </Centered>
            ) : phase.kind === 'error' ? (
                <Centered>
                    <Text style={styles.error}>{phase.message}</Text>
                    <PrimaryButton label={t('common.retry')} onPress={resetToEntry} />
                </Centered>
            ) : phase.kind === 'enterId' ? (
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <OfflineBanner note="Only downloaded papers can be taken offline." />
                    <Text style={styles.label}>Paper id</Text>
                    <TextInput
                        style={styles.input}
                        value={paperIdText}
                        onChangeText={setPaperIdText}
                        placeholder="Enter a paper id"
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {formError ? <Text style={styles.error}>{formError}</Text> : null}
                    {downloadMsg ? <Text style={styles.muted}>{downloadMsg}</Text> : null}
                    <PrimaryButton label={t('focus.start')} onPress={() => void startPaper(paperIdText)} />
                    <SecondaryButton
                        label={isOffline ? 'Download (needs connection)' : 'Download for offline'}
                        onPress={() => void onDownload()}
                        disabled={isOffline}
                    />
                </ScrollView>
            ) : phase.kind === 'results' ? (
                <ScrollView contentContainerStyle={styles.scroll}>
                    <AttemptResults
                        result={phase.result}
                        questionsById={questionsById}
                        sourceType="TIMED"
                    />
                    <PrimaryButton label="Take another paper" onPress={resetToEntry} />
                </ScrollView>
            ) : (
                // running | submitting
                <View style={styles.flex}>
                    <View
                        style={[
                            styles.timerBar,
                            remainingSec <= 60 ? styles.timerBarUrgent : undefined,
                        ]}
                    >
                        <Text style={styles.timerLabel}>Time left</Text>
                        <Text
                            style={[
                                styles.timerText,
                                remainingSec <= 60 ? styles.timerTextUrgent : undefined,
                            ]}
                        >
                            {formatClock(remainingSec)}
                        </Text>
                    </View>

                    <ScrollView
                        contentContainerStyle={styles.scroll}
                        keyboardShouldPersistTaps="handled"
                    >
                        {phase.paper.questions.length === 0 ? (
                            <Text style={styles.muted}>This paper has no questions.</Text>
                        ) : (
                            phase.paper.questions.map((q, i) => (
                                <QuestionCard
                                    key={q.id}
                                    question={q}
                                    position={i + 1}
                                    selectedOption={answers[q.id] ?? null}
                                    disabled={phase.kind === 'submitting'}
                                    onSelect={(optionIndex) =>
                                        setAnswers((prev) => ({ ...prev, [q.id]: optionIndex }))
                                    }
                                />
                            ))
                        )}
                        {formError ? <Text style={styles.error}>{formError}</Text> : null}
                        <PrimaryButton
                            label={t('pyq.submit')}
                            busy={phase.kind === 'submitting'}
                            onPress={() => void doSubmit(phase.paper)}
                        />
                    </ScrollView>
                </View>
            )}
        </Screen>
    );
}

// ── Small local UI helpers ──────────────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <View style={styles.centered}>{children}</View>;
}

function PrimaryButton({
    label,
    onPress,
    busy = false,
}: {
    label: string;
    onPress: () => void;
    busy?: boolean;
}): React.JSX.Element {
    return (
        <Pressable
            onPress={onPress}
            disabled={busy}
            accessibilityRole="button"
            style={[styles.primaryButton, busy ? styles.buttonDisabled : undefined]}
        >
            {busy ? (
                <ActivityIndicator size="small" color="#ffffff" />
            ) : (
                <Text style={styles.primaryButtonText}>{label}</Text>
            )}
        </Pressable>
    );
}

function SecondaryButton({
    label,
    onPress,
    disabled = false,
}: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
}): React.JSX.Element {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            style={[styles.secondaryButton, disabled ? styles.buttonDisabled : undefined]}
        >
            <Text style={styles.secondaryButtonText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    scroll: {
        paddingBottom: 32,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
        marginTop: 8,
    },
    input: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
        color: '#111827',
        marginBottom: 8,
    },
    timerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#eff6ff',
        borderRadius: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginBottom: 12,
    },
    timerBarUrgent: {
        backgroundColor: '#fef2f2',
    },
    timerLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    timerText: {
        fontSize: 24,
        fontWeight: '700',
        color: '#1d4ed8',
        fontVariant: ['tabular-nums'],
    },
    timerTextUrgent: {
        color: '#dc2626',
    },
    muted: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 12,
    },
    error: {
        fontSize: 14,
        color: '#dc2626',
        marginBottom: 12,
    },
    primaryButton: {
        backgroundColor: '#2563eb',
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: 'center',
        marginTop: 12,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    secondaryButton: {
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    secondaryButtonText: {
        color: '#2563eb',
        fontSize: 15,
        fontWeight: '600',
    },
    buttonDisabled: {
        opacity: 0.6,
    },
});
