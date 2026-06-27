/**
 * Fixed-commitments editor for the onboarding screen (task 21.2; Req 2.1, 2.3).
 *
 * Lets the User add one or more recurring unavailable blocks (school, coaching, sleep) that
 * onboarding persists via `POST /onboarding`. Each candidate is run through the pure
 * {@link validateCommitment} helper before it is added, which enforces the client-side guard
 * that a commitment's end time must be strictly later than its start time (Req 2.3) — the
 * server re-validates the same boundary. Added commitments are listed with a remove control.
 *
 * Presentational + local-draft state only: the committed list lives in the parent screen and
 * is supplied/mutated through `commitments`, `onAdd`, and `onRemove`, so this component stays
 * free of API and routing concerns. All user-facing copy resolves through `t()` (Req 10.2).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTranslation } from '@/localization';

import { Chip, ChipRow, Section } from './OnboardingControls';
import type { FixedCommitmentInput } from './onboardingApi';
import { validateCommitment } from './validation';

/** Weekday catalog keys indexed by `dayOfWeek` (0 = Sunday … 6 = Saturday). */
const DAY_KEYS = [
    'onboarding.day.sun',
    'onboarding.day.mon',
    'onboarding.day.tue',
    'onboarding.day.wed',
    'onboarding.day.thu',
    'onboarding.day.fri',
    'onboarding.day.sat',
] as const;

interface FixedCommitmentsEditorProps {
    /** The committed list owned by the parent screen. */
    commitments: FixedCommitmentInput[];
    /** Append a validated commitment to the parent list. */
    onAdd: (commitment: FixedCommitmentInput) => void;
    /** Remove the commitment at `index` from the parent list. */
    onRemove: (index: number) => void;
    /** Disable all inputs while the screen is submitting. */
    disabled?: boolean;
}

export function FixedCommitmentsEditor({
    commitments,
    onAdd,
    onRemove,
    disabled,
}: FixedCommitmentsEditorProps): React.JSX.Element {
    const t = useTranslation();

    const [dayOfWeek, setDayOfWeek] = useState(1); // default Monday
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [label, setLabel] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleAdd = (): void => {
        const candidate: FixedCommitmentInput = {
            dayOfWeek,
            startTime: startTime.trim(),
            endTime: endTime.trim(),
            label: label.trim(),
        };
        // Client-side guard incl. end > start (Req 2.3); the server re-validates.
        const validationError = validateCommitment(candidate);
        if (validationError) {
            setError(validationError);
            return;
        }
        onAdd(candidate);
        setStartTime('');
        setEndTime('');
        setLabel('');
        setError(null);
    };

    return (
        <Section title={t('onboarding.fixedCommitments')} caption={t('onboarding.fixedCommitmentsCaption')}>
            {commitments.length > 0 ? (
                <View style={styles.list}>
                    {commitments.map((c, index) => (
                        <View key={`${c.dayOfWeek}-${c.startTime}-${c.endTime}-${index}`} style={styles.listRow}>
                            <Text style={styles.listText}>
                                {t(DAY_KEYS[c.dayOfWeek])} {c.startTime}–{c.endTime} · {c.label}
                            </Text>
                            <Pressable
                                onPress={() => onRemove(index)}
                                disabled={disabled}
                                accessibilityRole="button"
                                accessibilityLabel={`${t('onboarding.remove')} ${c.label}`}
                            >
                                <Text style={styles.remove}>{t('onboarding.remove')}</Text>
                            </Pressable>
                        </View>
                    ))}
                </View>
            ) : null}

            <Text style={styles.fieldLabel}>{t('onboarding.commitmentDay')}</Text>
            <ChipRow>
                {DAY_KEYS.map((key, day) => (
                    <Chip
                        key={key}
                        label={t(key)}
                        selected={dayOfWeek === day}
                        onPress={() => setDayOfWeek(day)}
                        disabled={disabled}
                    />
                ))}
            </ChipRow>

            <View style={styles.timeRow}>
                <View style={styles.timeField}>
                    <Text style={styles.fieldLabel}>{t('onboarding.commitmentStart')}</Text>
                    <TextInput
                        style={styles.input}
                        value={startTime}
                        onChangeText={setStartTime}
                        placeholder="09:00"
                        placeholderTextColor="#9ca3af"
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                        editable={!disabled}
                        accessibilityLabel={t('onboarding.commitmentStart')}
                    />
                </View>
                <View style={styles.timeField}>
                    <Text style={styles.fieldLabel}>{t('onboarding.commitmentEnd')}</Text>
                    <TextInput
                        style={styles.input}
                        value={endTime}
                        onChangeText={setEndTime}
                        placeholder="14:00"
                        placeholderTextColor="#9ca3af"
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                        editable={!disabled}
                        accessibilityLabel={t('onboarding.commitmentEnd')}
                    />
                </View>
            </View>

            <Text style={styles.fieldLabel}>{t('onboarding.commitmentLabel')}</Text>
            <TextInput
                style={styles.input}
                value={label}
                onChangeText={setLabel}
                placeholder={t('onboarding.commitmentLabelPlaceholder')}
                placeholderTextColor="#9ca3af"
                editable={!disabled}
                accessibilityLabel={t('onboarding.commitmentLabel')}
            />

            {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                    {error}
                </Text>
            ) : null}

            <Pressable
                style={[styles.add, disabled && styles.addDisabled]}
                onPress={handleAdd}
                disabled={disabled}
                accessibilityRole="button"
            >
                <Text style={styles.addText}>{t('onboarding.addCommitment')}</Text>
            </Pressable>
        </Section>
    );
}

const styles = StyleSheet.create({
    list: { marginTop: 4, marginBottom: 8, gap: 8 },
    listRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    listText: { flex: 1, fontSize: 14, color: '#111827', marginRight: 12 },
    remove: { color: '#b91c1c', fontSize: 14, fontWeight: '600' },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 12, marginBottom: 4 },
    timeRow: { flexDirection: 'row', gap: 12 },
    timeField: { flex: 1 },
    input: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
        color: '#111827',
        backgroundColor: '#ffffff',
    },
    error: { color: '#b91c1c', fontSize: 14, marginTop: 12, lineHeight: 20 },
    add: {
        marginTop: 16,
        borderWidth: 1,
        borderColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
    },
    addDisabled: { opacity: 0.6 },
    addText: { color: '#2563eb', fontSize: 15, fontWeight: '700' },
});
