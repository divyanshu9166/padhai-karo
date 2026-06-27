/**
 * Small presentational controls for the onboarding form (task 21.2).
 *
 * Kept local to the onboarding folder (no shared-component edits) and dependency-free — just
 * React Native primitives — so the form can render selectable chips and labelled sections
 * without pulling in a picker library the scaffold doesn't ship.
 */
import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/** A titled form section with optional helper/caption text. */
export function Section({
    title,
    caption,
    children,
}: {
    title: string;
    caption?: string;
    children: ReactNode;
}): React.JSX.Element {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {caption ? <Text style={styles.caption}>{caption}</Text> : null}
            {children}
        </View>
    );
}

/** A selectable pill. `selected` drives the active styling; toggles via `onPress`. */
export function Chip({
    label,
    selected,
    onPress,
    disabled,
}: {
    label: string;
    selected: boolean;
    onPress: () => void;
    disabled?: boolean;
}): React.JSX.Element {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
        >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
        </Pressable>
    );
}

/** Horizontal wrap container for a row of chips. */
export function ChipRow({ children }: { children: ReactNode }): React.JSX.Element {
    return <View style={styles.chipRow}>{children}</View>;
}

const styles = StyleSheet.create({
    section: { marginTop: 24 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
    caption: { fontSize: 13, color: '#6b7280', marginBottom: 10, lineHeight: 18 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    chip: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 9,
        backgroundColor: '#ffffff',
    },
    chipSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
    chipDisabled: { opacity: 0.5 },
    chipText: { fontSize: 14, color: '#374151', fontWeight: '600' },
    chipTextSelected: { color: '#1d4ed8' },
});
