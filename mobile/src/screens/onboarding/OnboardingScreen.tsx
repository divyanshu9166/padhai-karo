/**
 * Onboarding screen (task 21.2; Req 2.1, 2.2, 2.3, 2.6, 2.8, 2.9).
 *
 * Collects exam program/stage, target year, study status, fixed commitments, and peak focus windows,
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
import { saveSleepSchedule } from '@/api/upscProduct';

import { FixedCommitmentsEditor } from './FixedCommitmentsEditor';
import { Chip, ChipRow, Section } from './OnboardingControls';
import {
    submitOnboarding,
    type ExamProgramKey,
    type ExamStage,
    type FixedCommitmentInput,
    type PeakFocusWindow,
} from './onboardingApi';
import { validateOnboarding } from './validation';

const PEAK_WINDOWS: readonly { value: PeakFocusWindow; labelKey: string }[] = [
    { value: 'MORNING', labelKey: 'onboarding.peakMorning' },
    { value: 'AFTERNOON', labelKey: 'onboarding.peakAfternoon' },
    { value: 'NIGHT', labelKey: 'onboarding.peakNight' },
];

const PROGRAM_STAGES: Record<ExamProgramKey, readonly { value: ExamStage; labelKey: string }[]> = {
    UPSC_CSE: [
        { value: 'PRELIMS', labelKey: 'onboarding.stagePrelims' },
        { value: 'MAINS', labelKey: 'onboarding.stageMains' },
    ],
    SSC_CGL: [
        { value: 'TIER_1', labelKey: 'onboarding.stageTier1' },
        { value: 'TIER_2', labelKey: 'onboarding.stageTier2' },
    ],
};

export function OnboardingScreen(): React.JSX.Element {
    const t = useTranslation();
    const { refresh } = useAuth();

    const currentYear = useMemo(() => new Date().getUTCFullYear(), []);

    const [examProgram, setExamProgram] = useState<ExamProgramKey>('UPSC_CSE');
    const [examStage, setExamStage] = useState<ExamStage>('PRELIMS');
    const [targetYearText, setTargetYearText] = useState(String(currentYear + 1));
    const [examDate, setExamDate] = useState(`${currentYear + 1}-06-01`);
    const [currentClass, setCurrentClass] = useState('');
    const [peakWindows, setPeakWindows] = useState<PeakFocusWindow[]>([]);
    const [commitments, setCommitments] = useState<FixedCommitmentInput[]>([]);
    const [bedtime, setBedtime] = useState('23:00');
    const [wakeTime, setWakeTime] = useState('07:00');

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
            examProgram,
            examStage,
            targetYear: Number.isInteger(targetYear) ? targetYear : Number.NaN,
            examDate,
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
            await saveSleepSchedule({ bedtime, wakeTime, windDownMin: 30 });
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
                            label={t('onboarding.examUpsc')}
                            selected={examProgram === 'UPSC_CSE'}
                            onPress={() => {
                                setExamProgram('UPSC_CSE');
                                setExamStage('PRELIMS');
                            }}
                        />
                        <Chip
                            label={t('onboarding.examSsc')}
                            selected={examProgram === 'SSC_CGL'}
                            onPress={() => {
                                setExamProgram('SSC_CGL');
                                setExamStage('TIER_1');
                            }}
                        />
                    </ChipRow>
                </Section>

                <Section title={t('onboarding.selectStage')}>
                    <ChipRow>
                        {PROGRAM_STAGES[examProgram].map((stage) => (
                            <Chip
                                key={stage.value}
                                label={t(stage.labelKey)}
                                selected={examStage === stage.value}
                                onPress={() => setExamStage(stage.value)}
                                disabled={submitting}
                            />
                        ))}
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

                <Section title={t('onboarding.studyStatus')}>
                    <TextInput
                        style={styles.input}
                        value={currentClass}
                        onChangeText={setCurrentClass}
                        placeholder={t('onboarding.studyStatusPlaceholder')}
                        editable={!submitting}
                    />
                </Section>

                <FixedCommitmentsEditor
                    commitments={commitments}
                    onAdd={addCommitment}
                    onRemove={removeCommitment}
                    disabled={submitting}
                />

                <Section title={t('onboarding.sleepSchedule')} caption={t('onboarding.sleepScheduleCaption')}>
                    <TextInput style={styles.input} value={bedtime} onChangeText={setBedtime} placeholder={t('onboarding.bedtimePlaceholder')} editable={!submitting} />
                    <TextInput style={styles.input} value={wakeTime} onChangeText={setWakeTime} placeholder={t('onboarding.wakeTimePlaceholder')} editable={!submitting} />
                </Section>

                <Section title={t('onboarding.exactExamDate')} caption={t('onboarding.exactExamDateCaption')}>
                    <TextInput style={styles.input} value={examDate} onChangeText={setExamDate} placeholder={t('onboarding.examDatePlaceholder')} editable={!submitting} autoCapitalize="none" />
                </Section>

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
