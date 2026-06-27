/**
 * A single timetable block row (task 21.3).
 *
 * Renders one study block or Buffer_Slot. Buffer slots are visually distinguished (Req 3.1
 * rendering of `isBuffer`): a dashed accent, the "Buffer slot" label, and no edit/missed
 * actions (a buffer cannot be edited as study work or reported missed — the server rejects
 * marking a buffer missed with 422). Study blocks expose Edit, Mark-missed, and Delete.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { StudyBlock } from '@/api';
import { formatTimeRange } from './dateUtils';

interface BlockRowProps {
    block: StudyBlock;
    busy: boolean;
    onEdit: (block: StudyBlock) => void;
    onDelete: (block: StudyBlock) => void;
    onMarkMissed: (block: StudyBlock) => void;
    labels: {
        bufferSlot: string;
        edit: string;
        delete: string;
        markMissed: string;
        outsidePeak: string;
        highEnergy: string;
        lowEnergy: string;
        subject: string;
        noSubject: string;
    };
}

export function BlockRow({
    block,
    busy,
    onEdit,
    onDelete,
    onMarkMissed,
    labels,
}: BlockRowProps): React.JSX.Element {
    const energyLabel = block.energyLevel === 'HIGH' ? labels.highEnergy : labels.lowEnergy;

    return (
        <View style={[styles.row, block.isBuffer ? styles.bufferRow : styles.studyRow]}>
            <View style={styles.header}>
                <Text style={styles.time}>{formatTimeRange(block.startTime, block.durationMin)}</Text>
                <Text style={styles.meta}>
                    {block.durationMin} min · {energyLabel}
                </Text>
            </View>

            {block.isBuffer ? (
                <Text style={styles.bufferLabel}>{labels.bufferSlot}</Text>
            ) : (
                <Text style={styles.subject}>
                    {block.subjectId
                        ? `${labels.subject}: ${block.subjectId}`
                        : labels.noSubject}
                </Text>
            )}

            {block.scheduledOutsidePeak ? (
                <Text style={styles.outsidePeak}>{labels.outsidePeak}</Text>
            ) : null}

            {!block.isBuffer ? (
                <View style={styles.actions}>
                    <Pressable
                        style={[styles.actionButton, busy && styles.disabled]}
                        onPress={() => onEdit(block)}
                        disabled={busy}
                    >
                        <Text style={styles.actionText}>{labels.edit}</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.actionButton, busy && styles.disabled]}
                        onPress={() => onMarkMissed(block)}
                        disabled={busy}
                    >
                        <Text style={styles.actionText}>{labels.markMissed}</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.actionButton, busy && styles.disabled]}
                        onPress={() => onDelete(block)}
                        disabled={busy}
                    >
                        <Text style={[styles.actionText, styles.deleteText]}>{labels.delete}</Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
    },
    studyRow: {
        backgroundColor: '#ffffff',
        borderColor: '#e5e7eb',
    },
    bufferRow: {
        backgroundColor: '#f8fafc',
        borderColor: '#94a3b8',
        borderStyle: 'dashed',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    time: {
        fontSize: 15,
        fontWeight: '700',
        color: '#111827',
    },
    meta: {
        fontSize: 12,
        color: '#6b7280',
    },
    subject: {
        marginTop: 4,
        fontSize: 13,
        color: '#374151',
    },
    bufferLabel: {
        marginTop: 4,
        fontSize: 13,
        fontWeight: '600',
        color: '#475569',
        fontStyle: 'italic',
    },
    outsidePeak: {
        marginTop: 4,
        fontSize: 12,
        color: '#b45309',
    },
    actions: {
        flexDirection: 'row',
        marginTop: 10,
    },
    actionButton: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: '#f3f4f6',
        marginRight: 8,
    },
    actionText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#2563eb',
    },
    deleteText: {
        color: '#b91c1c',
    },
    disabled: {
        opacity: 0.5,
    },
});
