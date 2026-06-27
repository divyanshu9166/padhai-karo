/**
 * Buffer-policy selector (task 21.3; Req 15.4).
 *
 * Lets the user choose whether unused Buffer_Slots convert to catch-up time or extra revision
 * at week end (`PATCH /timetable/buffer-policy`). The screen owns the request and the selected
 * value; this is a presentational two-option toggle. The backend exposes no GET for the current
 * policy in the timetable flow, so `selected` is `null` until the user makes a choice.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BufferPolicy } from '@/api';

interface BufferPolicyBarProps {
    selected: BufferPolicy | null;
    busy: boolean;
    onSelect: (policy: BufferPolicy) => void;
    labels: {
        title: string;
        catchUp: string;
        extraRevision: string;
    };
}

const OPTIONS: ReadonlyArray<{ value: BufferPolicy; labelKey: 'catchUp' | 'extraRevision' }> = [
    { value: 'CATCH_UP', labelKey: 'catchUp' },
    { value: 'EXTRA_REVISION', labelKey: 'extraRevision' },
];

export function BufferPolicyBar({
    selected,
    busy,
    onSelect,
    labels,
}: BufferPolicyBarProps): React.JSX.Element {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>{labels.title}</Text>
            <View style={styles.row}>
                {OPTIONS.map((option) => {
                    const isSelected = option.value === selected;
                    return (
                        <Pressable
                            key={option.value}
                            style={[styles.chip, isSelected && styles.chipSelected, busy && styles.disabled]}
                            onPress={() => onSelect(option.value)}
                            disabled={busy}
                        >
                            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                                {labels[option.labelKey]}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { marginBottom: 12 },
    title: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
    row: { flexDirection: 'row' },
    chip: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 6,
        marginRight: 8,
    },
    chipSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    chipText: { color: '#374151', fontSize: 13, fontWeight: '600' },
    chipTextSelected: { color: '#ffffff' },
    disabled: { opacity: 0.5 },
});
