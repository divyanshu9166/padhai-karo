/**
 * Edit-block modal (task 21.3).
 *
 * Lets the user adjust a study block's start time, duration, and subject id, then submit a
 * `PATCH /timetable/blocks/:id`. The screen owns the API call and conflict handling; this
 * component is a controlled form that collects the edited fields and reports the patch (only
 * the changed fields) back via `onSubmit`. Start time is edited as an ISO-8601 string and
 * duration as whole minutes — deliberately dependency-free (no native date picker is bundled
 * in the scaffold). A surfaced 409 overlap message is shown inline above the actions (Req 3.5).
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

import type { EditBlockInput, StudyBlock } from '@/api';

interface EditBlockModalProps {
    /** The block being edited, or `null` when the modal is closed. */
    block: StudyBlock | null;
    /** True while the PATCH is in flight (disables the actions, shows a spinner). */
    submitting: boolean;
    /** Inline error to show (e.g. the surfaced 409 overlap message), or `null`. */
    errorMessage: string | null;
    /** Submit the changed fields. The screen performs the request. */
    onSubmit: (patch: EditBlockInput) => void;
    /** Close without saving. */
    onCancel: () => void;
    /** Localized labels. */
    labels: {
        title: string;
        startTime: string;
        durationMin: string;
        subjectId: string;
        save: string;
        cancel: string;
    };
}

export function EditBlockModal({
    block,
    submitting,
    errorMessage,
    onSubmit,
    onCancel,
    labels,
}: EditBlockModalProps): React.JSX.Element {
    const [startTime, setStartTime] = useState('');
    const [durationMin, setDurationMin] = useState('');
    const [subjectId, setSubjectId] = useState('');

    // Re-seed the form whenever a different block opens the modal.
    useEffect(() => {
        if (block) {
            setStartTime(block.startTime);
            setDurationMin(String(block.durationMin));
            setSubjectId(block.subjectId ?? '');
        }
    }, [block]);

    function handleSave(): void {
        if (!block) return;
        const patch: EditBlockInput = {};

        const trimmedStart = startTime.trim();
        if (trimmedStart !== '' && trimmedStart !== block.startTime) {
            patch.startTime = trimmedStart;
        }

        const parsedDuration = Number.parseInt(durationMin.trim(), 10);
        if (Number.isInteger(parsedDuration) && parsedDuration !== block.durationMin) {
            patch.durationMin = parsedDuration;
        }

        const trimmedSubject = subjectId.trim();
        const nextSubject = trimmedSubject === '' ? null : trimmedSubject;
        if (nextSubject !== (block.subjectId ?? null)) {
            patch.subjectId = nextSubject;
        }

        onSubmit(patch);
    }

    return (
        <Modal
            visible={block !== null}
            transparent
            animationType="fade"
            onRequestClose={onCancel}
        >
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <Text style={styles.title}>{labels.title}</Text>

                    <Text style={styles.label}>{labels.startTime}</Text>
                    <TextInput
                        style={styles.input}
                        value={startTime}
                        onChangeText={setStartTime}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="2026-06-01T09:00:00.000Z"
                        editable={!submitting}
                    />

                    <Text style={styles.label}>{labels.durationMin}</Text>
                    <TextInput
                        style={styles.input}
                        value={durationMin}
                        onChangeText={setDurationMin}
                        keyboardType="number-pad"
                        editable={!submitting}
                    />

                    <Text style={styles.label}>{labels.subjectId}</Text>
                    <TextInput
                        style={styles.input}
                        value={subjectId}
                        onChangeText={setSubjectId}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!submitting}
                    />

                    {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

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
