/**
 * Add-calendar-event modal (task 21.3; Req 16.1).
 *
 * Collects a calendar event's type (School_Exam / Holiday / Mock_Test) and its start/end dates,
 * then reports them to the screen which performs `POST /calendar-events`. Dates are entered as
 * `YYYY-MM-DD` strings (no native date picker is bundled in the scaffold). The server rejects an
 * end date earlier than the start date with 422 (Req 16.2); that message is surfaced inline.
 */
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import type { CalendarEventType, CreateCalendarEventInput } from '@/api';

interface CalendarEventModalProps {
    visible: boolean;
    submitting: boolean;
    errorMessage: string | null;
    onSubmit: (input: CreateCalendarEventInput) => void;
    onCancel: () => void;
    labels: {
        title: string;
        type: string;
        startDate: string;
        endDate: string;
        save: string;
        cancel: string;
        dateFormatError: string;
        typeLabels: Record<CalendarEventType, string>;
    };
}

const EVENT_TYPES: CalendarEventType[] = ['SCHOOL_EXAM', 'HOLIDAY', 'MOCK_TEST'];

/** Convert a `YYYY-MM-DD` input to a UTC-midnight ISO string; returns null when unparseable. */
function dayInputToIso(value: string): string | null {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return null;
    }
    const date = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function CalendarEventModal({
    visible,
    submitting,
    errorMessage,
    onSubmit,
    onCancel,
    labels,
}: CalendarEventModalProps): React.JSX.Element {
    const [type, setType] = useState<CalendarEventType>('SCHOOL_EXAM');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);

    // Reset the form each time the modal opens.
    useEffect(() => {
        if (visible) {
            setType('SCHOOL_EXAM');
            setStartDate('');
            setEndDate('');
            setLocalError(null);
        }
    }, [visible]);

    function handleSave(): void {
        const startIso = dayInputToIso(startDate);
        const endIso = dayInputToIso(endDate);
        if (startIso === null || endIso === null) {
            setLocalError(labels.dateFormatError);
            return;
        }
        setLocalError(null);
        onSubmit({ type, startDate: startIso, endDate: endIso });
    }

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <Text style={styles.title}>{labels.title}</Text>

                    <Text style={styles.label}>{labels.type}</Text>
                    <View style={styles.typeRow}>
                        {EVENT_TYPES.map((eventType) => {
                            const selected = eventType === type;
                            return (
                                <Pressable
                                    key={eventType}
                                    style={[styles.typeChip, selected && styles.typeChipSelected]}
                                    onPress={() => setType(eventType)}
                                    disabled={submitting}
                                >
                                    <Text
                                        style={[
                                            styles.typeChipText,
                                            selected && styles.typeChipTextSelected,
                                        ]}
                                    >
                                        {labels.typeLabels[eventType]}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    <Text style={styles.label}>{labels.startDate}</Text>
                    <TextInput
                        style={styles.input}
                        value={startDate}
                        onChangeText={setStartDate}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="2026-06-01"
                        editable={!submitting}
                    />

                    <Text style={styles.label}>{labels.endDate}</Text>
                    <TextInput
                        style={styles.input}
                        value={endDate}
                        onChangeText={setEndDate}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="2026-06-10"
                        editable={!submitting}
                    />

                    {(localError ?? errorMessage) ? (
                        <Text style={styles.error}>{localError ?? errorMessage}</Text>
                    ) : null}

                    <View style={styles.actions}>
                        <Pressable
                            style={[styles.button, styles.cancelButton]}
                            onPress={onCancel}
                            disabled={submitting}
                        >
                            <Text style={styles.cancelText}>{labels.cancel}</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.button, styles.saveButton, submitting && styles.disabled]}
                            onPress={handleSave}
                            disabled={submitting}
                        >
                            {submitting ? (
                                <ActivityIndicator color="#ffffff" />
                            ) : (
                                <Text style={styles.saveText}>{labels.save}</Text>
                            )}
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 20,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 12,
    },
    label: {
        fontSize: 13,
        fontWeight: '600',
        color: '#374151',
        marginTop: 10,
        marginBottom: 4,
    },
    typeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    typeChip: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginRight: 8,
        marginBottom: 8,
    },
    typeChipSelected: {
        backgroundColor: '#2563eb',
        borderColor: '#2563eb',
    },
    typeChipText: {
        color: '#374151',
        fontSize: 13,
        fontWeight: '600',
    },
    typeChipTextSelected: {
        color: '#ffffff',
    },
    input: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 14,
        color: '#111827',
    },
    error: {
        marginTop: 12,
        color: '#b91c1c',
        fontSize: 13,
        lineHeight: 18,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 20,
    },
    button: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        marginLeft: 12,
        minWidth: 88,
        alignItems: 'center',
    },
    cancelButton: {
        backgroundColor: '#f3f4f6',
    },
    saveButton: {
        backgroundColor: '#2563eb',
    },
    disabled: {
        opacity: 0.6,
    },
    cancelText: {
        color: '#374151',
        fontWeight: '600',
    },
    saveText: {
        color: '#ffffff',
        fontWeight: '700',
    },
});
