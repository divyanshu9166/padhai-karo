/**
 * Selectable chip primitive for the Practice screens (task 21.6).
 *
 * Used for the PYQ subject filter, the Mistake Journal subject/category filters, and the
 * flag-to-journal category picker. Purely presentational; selection state and handling are
 * owned by the parent screen.
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

interface ChipProps {
    label: string;
    selected?: boolean;
    onPress: () => void;
    disabled?: boolean;
}

export function Chip({ label, selected = false, onPress, disabled = false }: ChipProps): React.JSX.Element {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            style={[
                styles.chip,
                selected ? styles.chipSelected : undefined,
                disabled ? styles.chipDisabled : undefined,
            ]}
        >
            <Text style={[styles.label, selected ? styles.labelSelected : undefined]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    chip: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#d1d5db',
        backgroundColor: '#ffffff',
        marginRight: 8,
        marginBottom: 8,
    },
    chipSelected: {
        backgroundColor: '#2563eb',
        borderColor: '#2563eb',
    },
    chipDisabled: {
        opacity: 0.5,
    },
    label: {
        fontSize: 14,
        color: '#374151',
    },
    labelSelected: {
        color: '#ffffff',
        fontWeight: '600',
    },
});
