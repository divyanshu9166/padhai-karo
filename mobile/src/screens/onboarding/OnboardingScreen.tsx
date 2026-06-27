/**
 * Onboarding screen (task 21.2; Req 2.1, 2.2, 2.3, 2.6, 2.8, 2.9).
 *
 * Collects exam track, target year, current class, fixed commitments, and peak focus windows,
 * pre-validates with the pure {@link validateOnboarding} helper (Req 2.2/2.3), then submits to
 * `POST /onboarding` (the server re-validates and loads the track's reference chapters, Req 2.4).
 * On success it calls `useAuth().refresh()` so `/auth/me` reports `profileComplete: true` and
 * the RootNavigator advances to the main app (Req 2.6).
 *
 * Reconstructed during scaffold recovery; composes the surviving `OnboardingControls`,
 * `validation`, and `onboardingApi` modules.
 */
import React, { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
} from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import { useAuth } from '@/state';

import { FixedCommitmentsEditor } from './FixedCommitmentsEditor';
import { Chip, ChipRow, Section } from './OnboardingControls';
import {
    submitOnboarding,
    type ExamTrack,
    type FixedCommitmentInput,
    type PeakFocusWindow,
} from './onboardingApi';
import { validateOnboarding } from './validation';

const PEAK_WINDOWS: readonly { value: PeakFocusWindow; labelKey: string }[] = [
    { value: 'MORNING', labelKey: 'onboarding.peakMorning' },
    { value: 'AFTERNOON', labelKey: 'onboarding.peakAfternoon' },
    { value: 'NIGHT', labelKey: 'onboarding.peakNight' },
];

export function OnboardingScreen(): React.JSX.Element {
    const t = useTranslation();
    const { refresh } = useAuth();

    const currentYear = useMemo(() => new Date().getUTCFullYear(), []);

    const [examTrack, setExamTrack] = useState<ExamTrack>('JEE');
    const [targetYearText, setTargetYearText] = useState(String(currentYear + 1));
    const [currentClass, setCurrentClass] = useState('');
    const [peakWindows, setPeakWindows] = useState<PeakFocusWindow[]>([]);
    const [commitments, setCommitments] = useState<FixedCommitmentInput[]>([]);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const togglePeak = (window: PeakFocusWindow): void => {
        setPeakWindows((prev) =>
            prev.includes(window) ? prev.filter((w) => w !== window) : [...prev, window],
        );
    };

    const addCommitment = (commitment: FixedCommitmentInput): void => {
        setCommitments((prev) => [...prev, commitment]);
    };

    const removeCommitment = (index: number): void => {
        setCommitments((prev) => prev.filter((_, i) => i !== index));
    };

    const onSubmit = async (): Promise<void> => {
        setError(null);
        const targetYear = Number(targetYearText.trim());
        const payload = {
            examTrack,
            targetYear: Number.isInteger(targetYear) ? targetYear : Number.NaN,
            currentClass,
            fixedCommitments: commitments,
            peakFocusWindows: peakWindows,
        };

        const validationError = validateOnboarding(payload, currentYear);
        if (validationError) {
            setError(validationError);
            return;
        }

        setSubmitting(true);
        try {
            await submitOnboarding(payload);
            // Advance the onboarding gate: /auth/me now reports profileComplete: true (Req 2.6).
            await refresh();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : t('onboarding.saveError'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Screen title={t('onboarding.title')}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                <Section title={t('onboarding.selectExam')}>
                    <ChipRow>
                        <Chip
                            label={t('onboarding.examJee')}
                            selected={examTrack === 'JEE'}
                            onPress={() => setExamTrack('JEE')}
                        />
                        <Chip
                            label={t('onboarding.examNeet')}
                            selected={examTrack === 'NEET'}
                            onPress={() => setExamTrack('NEET')}
                        />
                    </ChipRow>
                </Section>

                <Section title={t('onboarding.targetYear')}>
                    <TextInput
                        style={styles.input}
                        value={targetYearText}
                        onChangeText={setTargetYearText}
                        keyboardType="number-pad"
                        maxLength={4}
                        editable={!submitting}
                    />
                </Section>

                <Section title={t('onboarding.currentClass')}>
                    <TextInput
                        style={styles.input}
                        value={currentClass}
                        onChangeText={setCurrentClass}
                        placeholder={t('onboarding.currentClassPlaceholder')}
                        editable={!submitting}
                    />
                </Section>

                <FixedCommitmentsEditor
                    commitments={commitments}
                    onAdd={addCommitment}
                    onRemove={removeCommitment}
                    disabled={submitting}
                />

                <Section
                    title={t('onboarding.peakFocusWindows')}
                    caption={t('onboarding.peakFocusWindowsCaption')}
                >
                    <ChipRow>
                        {PEAK_WINDOWS.map((w) => (
                            <Chip
                                key={w.value}
                                label={t(w.labelKey)}
                                selected={peakWindows.includes(w.value)}
                                onPress={() => togglePeak(w.value)}
                                disabled={submitting}
                            />
                        ))}
                    </ChipRow>
                </Section>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                    style={[styles.submit, submitting && styles.disabled]}
                    onPress={() => void onSubmit()}
                    disabled={submitting}
                    accessibilityRole="button"
                >
                    {submitting ? (
                        <ActivityIndicator color="#ffffff" />
                    ) : (
                        <Text style={styles.submitText}>{t('common.done')}</Text>
                    )}
                </Pressable>
            </ScrollView>
        </Screen>
    );
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 },
    input: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
        color: '#111827',
        marginTop: 4,
    },
    error: { color: '#b91c1c', fontSize: 14, marginTop: 16 },
    submit: {
        marginTop: 28,
        backgroundColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 14,
        alignItems: 'center',
        minHeight: 48,
        justifyContent: 'center',
    },
    disabled: { opacity: 0.6 },
    submitText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
