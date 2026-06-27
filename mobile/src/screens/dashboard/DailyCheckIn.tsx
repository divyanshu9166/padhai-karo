/**
 * Daily check-in form (task 21.5; Req 14.1).
 *
 * Records planned vs actual study minutes for today via `POST /api/audits/daily`. `actualMin`
 * is optional: when left blank the server derives the actual figure from that day's focus
 * sessions (Req 14.2/14.3), so the form submits `actualMin` only when the user entered one.
 * On success it echoes the persisted planned/actual the server stored.
 */

import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';

import { ApiError } from '@/api';
import { useTranslation } from '@/localization';

import { postDailyAudit, type DailyAudit } from './api';
import { formatMinutes, parseMinutesInput, todayUtcDateString } from './helpers';
import { Card, SectionHeading } from './ui';

export function DailyCheckIn(): React.JSX.Element {
    const t = useTranslation();
    const [plannedText, setPlannedText] = useState('');
    const [actualText, setActualText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<DailyAudit | null>(null);

    const submit = async (): Promise<void> => {
        setError(null);
        setSaved(null);

        const plannedMin = parseMinutesInput(plannedText);
        if (plannedMin === null) {
            setError(t('checkin.plannedError'));
            return;
        }

        // actualMin is optional — blank means "derive from today's focus sessions".
        let actualMin: number | undefined;
        if (actualText.trim().length > 0) {
            const parsed = parseMinutesInput(actualText);
            if (parsed === null) {
                setError(t('checkin.actualError'));
                return;
            }
            actualMin = parsed;
        }

        setSubmitting(true);
        try {
            const { audit } = await postDailyAudit({
                date: todayUtcDateString(),
                plannedMin,
                ...(actualMin !== undefined ? { actualMin } : {}),
            });
            setSaved(audit);
            setActualText('');
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
            } else {
                setError(t('checkin.saveError'));
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card>
            <SectionHeading title={t('checkin.title')} />
            <Text style={styles.hint}>{t('checkin.hint')}</Text>

            <Text style={styles.fieldLabel}>{t('checkin.plannedLabel')}</Text>
            <TextInput
                style={styles.input}
                value={plannedText}
                onChangeText={setPlannedText}
                keyboardType="number-pad"
                placeholder={t('checkin.plannedPlaceholder')}
                editable={!submitting}
            />

            <Text style={styles.fieldLabel}>{t('checkin.actualLabel')}</Text>
            <TextInput
                style={styles.input}
                value={actualText}
                onChangeText={setActualText}
                keyboardType="number-pad"
                placeholder={t('checkin.actualPlaceholder')}
                editable={!submitting}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {saved ? (
                <Text style={styles.success}>
                    {`${t('checkin.saved')} — ${t('checkin.plannedLabel')}: ${formatMinutes(
                        saved.plannedMin,
                    )}, ${t('checkin.actualLabel')}: ${formatMinutes(saved.actualMin)}`}
                </Text>
            ) : null}

            <TouchableOpacity
                style={[styles.button, submitting && styles.buttonDisabled]}
                onPress={() => void submit()}
                disabled={submitting}
                accessibilityRole="button"
            >
                {submitting ? (
                    <ActivityIndicator color="#ffffff" />
                ) : (
                    <Text style={styles.buttonText}>{t('checkin.saveButton')}</Text>
                )}
            </TouchableOpacity>
        </Card>
    );
}

const styles = StyleSheet.create({
    hint: {
        fontSize: 13,
        color: '#6b7280',
        marginBottom: 12,
        lineHeight: 18,
    },
    fieldLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 4,
    },
    input: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 15,
        color: '#111827',
        marginBottom: 12,
    },
    error: {
        color: '#b91c1c',
        fontSize: 13,
        marginBottom: 8,
    },
    success: {
        color: '#15803d',
        fontSize: 13,
        marginBottom: 8,
    },
    button: {
        backgroundColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 4,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },
});
