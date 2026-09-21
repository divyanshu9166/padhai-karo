import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Screen } from '@/components';

export const palette = { ink: '#111827', muted: '#6b7280', brand: '#2563eb', brandText: '#1d4ed8', brandSoft: '#eff6ff', border: '#e5e7eb', success: '#ecfdf5', warning: '#fffbeb', revision: '#ede9fe', canvas: '#ffffff' } as const;

export function FeatureScreen({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }): React.JSX.Element {
    return <Screen title={title}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}{children}</ScrollView></Screen>;
}

export function Card({ children, tone = 'plain', style }: { children: React.ReactNode; tone?: 'plain' | 'brand' | 'success' | 'warning' | 'revision'; style?: ViewStyle }): React.JSX.Element {
    return <View style={[styles.card, tone === 'brand' && styles.brand, tone === 'success' && styles.success, tone === 'warning' && styles.warning, tone === 'revision' && styles.revision, style]}>{children}</View>;
}

export function Heading({ children }: { children: React.ReactNode }): React.JSX.Element { return <Text style={styles.heading}>{children}</Text>; }
export function Body({ children }: { children: React.ReactNode }): React.JSX.Element { return <Text style={styles.body}>{children}</Text>; }
export function Muted({ children }: { children: React.ReactNode }): React.JSX.Element { return <Text style={styles.muted}>{children}</Text>; }
export function Eyebrow({ children }: { children: React.ReactNode }): React.JSX.Element { return <Text style={styles.eyebrow}>{children}</Text>; }
export function Action({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }): React.JSX.Element {
    return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.action, secondary && styles.secondary, disabled && styles.disabled]}><Text style={[styles.actionText, secondary && styles.secondaryText]}>{label}</Text></Pressable>;
}
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }): React.JSX.Element {
    return <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}
export function Progress({ value }: { value: number }): React.JSX.Element { return <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(0, Math.min(100, value))}%` }]} /></View>; }

export const featureStyles = StyleSheet.create({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
    input: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, color: palette.ink, backgroundColor: palette.canvas, marginBottom: 10 },
    multiline: { minHeight: 100, textAlignVertical: 'top' },
    big: { color: palette.ink, fontSize: 30, fontWeight: '800' },
    score: { color: palette.brand, fontSize: 28, fontWeight: '800' },
    link: { color: palette.brandText, fontWeight: '700', marginTop: 8 },
    danger: { color: '#dc2626', fontWeight: '700' },
});

const styles = StyleSheet.create({
    scroll: { paddingBottom: 40 }, subtitle: { color: palette.muted, lineHeight: 19, marginBottom: 14 },
    card: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.canvas, borderRadius: 16, padding: 16, marginBottom: 12 },
    brand: { backgroundColor: palette.brandSoft, borderColor: palette.brandSoft }, success: { backgroundColor: palette.success, borderColor: palette.success }, warning: { backgroundColor: palette.warning, borderColor: palette.warning }, revision: { backgroundColor: palette.revision, borderColor: palette.revision },
    heading: { color: palette.ink, fontSize: 16, fontWeight: '800', marginBottom: 7 }, body: { color: '#374151', lineHeight: 20, marginBottom: 4 }, muted: { color: palette.muted, lineHeight: 19, marginBottom: 4 }, eyebrow: { color: palette.brandText, fontSize: 11, fontWeight: '800', letterSpacing: 0.7, marginBottom: 6 },
    action: { minHeight: 48, borderRadius: 12, backgroundColor: palette.brand, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10 }, actionText: { color: '#fff', fontWeight: '700' }, secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: palette.border }, secondaryText: { color: palette.brandText }, disabled: { opacity: 0.5 },
    chip: { minHeight: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: palette.border, justifyContent: 'center', backgroundColor: '#fff' }, chipSelected: { backgroundColor: palette.brandSoft, borderColor: palette.brandSoft }, chipText: { color: palette.ink, fontSize: 12, fontWeight: '600' }, chipTextSelected: { color: palette.brandText },
    track: { height: 8, backgroundColor: '#dbeafe', borderRadius: 999, overflow: 'hidden', marginTop: 8 }, fill: { height: 8, borderRadius: 999, backgroundColor: palette.brand },
});
