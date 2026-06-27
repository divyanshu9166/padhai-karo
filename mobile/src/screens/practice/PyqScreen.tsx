/**
 * PYQ practice screen (task 21.6; Req 6.1, 6.2).
 *
 * Lets the user filter Previous-Year Questions by year and subject (GET /pyqs), answer them
 * with options-only cards (no answer key is ever sent to the client), submit the attempt
 * (POST /pyq-attempts), and see instant per-question scoring. Incorrect/unanswered questions
 * can be flagged straight into the categorized Mistake Journal from the results view.
 *
 * Subjects are loaded for the user's Exam_Track (resolved from their profile); a subject's
 * reference key is the `subjectId` the practice query expects.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';

import {
    getProfileTrack,
    listPyqs,
    listSubjects,
    submitPyqAttempt,
    type AttemptResult,
    type ClientPYQ,
    type ReferenceSubject,
} from './api';
import { AttemptResults } from './components/AttemptResults';
import { Chip } from './components/Chip';
import { QuestionCard } from './components/QuestionCard';

type Phase =
    | { kind: 'loadingFilters' }
    | { kind: 'filtersError'; message: string }
    | { kind: 'filtering' }
    | { kind: 'loadingQuestions' }
    | { kind: 'practicing'; questions: ClientPYQ[] }
    | { kind: 'submitting'; questions: ClientPYQ[] }
    | { kind: 'results'; questions: ClientPYQ[]; result: AttemptResult };

export function PyqScreen(): React.JSX.Element {
    const t = useTranslation();

    const [subjects, setSubjects] = useState<ReferenceSubject[]>([]);
    const [phase, setPhase] = useState<Phase>({ kind: 'loadingFilters' });

    const [yearText, setYearText] = useState('');
    const [subjectId, setSubjectId] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Record<string, number | null>>({});
    const [formError, setFormError] = useState<string | null>(null);

    const loadFilters = useCallback(async (): Promise<void> => {
        setPhase({ kind: 'loadingFilters' });
        try {
            const track = await getProfileTrack();
            const list = await listSubjects(track);
            setSubjects(list);
            setPhase({ kind: 'filtering' });
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : 'Could not load subjects. Try again.';
            setPhase({ kind: 'filtersError', message });
        }
    }, []);

    useEffect(() => {
        void loadFilters();
    }, [loadFilters]);

    const questionsById = useMemo<Record<string, ClientPYQ>>(() => {
        const map: Record<string, ClientPYQ> = {};
        if (phase.kind === 'practicing' || phase.kind === 'submitting' || phase.kind === 'results') {
            for (const q of phase.questions) map[q.id] = q;
        }
        return map;
    }, [phase]);

    const onLoadQuestions = async (): Promise<void> => {
        setFormError(null);
        const year = Number(yearText.trim());
        if (!/^\d{4}$/.test(yearText.trim()) || !Number.isInteger(year)) {
            setFormError('Enter a valid 4-digit year.');
            return;
        }
        if (!subjectId) {
            setFormError(t('pyq.filterBySubject'));
            return;
        }
        setPhase({ kind: 'loadingQuestions' });
        try {
            const questions = await listPyqs(year, subjectId);
            setAnswers({});
            setPhase({ kind: 'practicing', questions });
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : 'Could not load questions. Try again.';
            setFormError(message);
            setPhase({ kind: 'filtering' });
        }
    };

    const onSubmit = async (questions: ClientPYQ[]): Promise<void> => {
        setPhase({ kind: 'submitting', questions });
        try {
            const result = await submitPyqAttempt({
                paperOrSetRef: `pyq:${subjectId}:${yearText.trim()}`,
                answers: questions.map((q) => ({
                    questionId: q.id,
                    selectedOption: answers[q.id] ?? null,
                })),
            });
            setPhase({ kind: 'results', questions, result });
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : 'Could not submit answers. Try again.';
            setFormError(message);
            setPhase({ kind: 'practicing', questions });
        }
    };

    const resetToFilters = (): void => {
        setAnswers({});
        setFormError(null);
        setPhase({ kind: 'filtering' });
    };

    return (
        <Screen title={t('pyq.title')}>
            {phase.kind === 'loadingFilters' ? (
                <Centered>
                    <ActivityIndicator size="large" color="#2563eb" />
                </Centered>
            ) : phase.kind === 'filtersError' ? (
                <Centered>
                    <Text style={styles.error}>{phase.message}</Text>
                    <PrimaryButton label={t('common.retry')} onPress={() => void loadFilters()} />
                </Centered>
            ) : (
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    {phase.kind === 'results' ? (
                        <>
                            <AttemptResults
                                result={phase.result}
                                questionsById={questionsById}
                                sourceType="PYQ"
                            />
                            <PrimaryButton label="Practice more" onPress={resetToFilters} />
                        </>
                    ) : phase.kind === 'practicing' || phase.kind === 'submitting' ? (
                        <>
                            {phase.questions.length === 0 ? (
                                <Text style={styles.muted}>No questions match this filter.</Text>
                            ) : (
                                phase.questions.map((q, i) => (
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
                                disabled={phase.questions.length === 0}
                                onPress={() => void onSubmit(phase.questions)}
                            />
                            <SecondaryButton label={t('common.back')} onPress={resetToFilters} />
                        </>
                    ) : (
                        <>
                            <Text style={styles.label}>{t('pyq.filterByYear')}</Text>
                            <TextInput
                                style={styles.input}
                                value={yearText}
                                onChangeText={setYearText}
                                placeholder="e.g. 2024"
                                keyboardType="number-pad"
                                maxLength={4}
                            />

                            <Text style={styles.label}>{t('pyq.filterBySubject')}</Text>
                            <View style={styles.chipRow}>
                                {subjects.map((s) => (
                                    <Chip
                                        key={s.key}
                                        label={s.name}
                                        selected={subjectId === s.key}
                                        onPress={() => setSubjectId(s.key)}
                                    />
                                ))}
                            </View>

                            {formError ? <Text style={styles.error}>{formError}</Text> : null}
                            <PrimaryButton
                                label={phase.kind === 'loadingQuestions' ? t('common.loading') : t('common.next')}
                                busy={phase.kind === 'loadingQuestions'}
                                onPress={() => void onLoadQuestions()}
                            />
                        </>
                    )}
                </ScrollView>
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
    disabled = false,
}: {
    label: string;
    onPress: () => void;
    busy?: boolean;
    disabled?: boolean;
}): React.JSX.Element {
    return (
        <Pressable
            onPress={onPress}
            disabled={busy || disabled}
            accessibilityRole="button"
            style={[styles.primaryButton, busy || disabled ? styles.buttonDisabled : undefined]}
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
}: {
    label: string;
    onPress: () => void;
}): React.JSX.Element {
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
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
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 8,
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
    buttonDisabled: {
        opacity: 0.6,
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
});
