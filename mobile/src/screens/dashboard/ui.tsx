/**
 * Small presentational primitives local to the dashboard feature (task 21.5).
 *
 * Card, section heading, stat row, and a chapter-status badge — kept here so the screen and
 * the daily check-in component share consistent styling without touching the shared
 * component library. Inline English copy is finalized for localization in task 21.8.
 */

import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '@/localization';

import type { ChapterStatus } from './api';
import { chapterStatusKey } from './helpers';

/** A bordered surface grouping a section's content. */
export function Card({ children }: { children: ReactNode }): React.JSX.Element {
    return <View style={styles.card}>{children}</View>;
}

/** A section heading with an optional trailing accessory (e.g. a value or action). */
export function SectionHeading({
    title,
    accessory,
}: {
    title: string;
    accessory?: ReactNode;
}): React.JSX.Element {
    return (
        <View style={styles.headingRow}>
            <Text style={styles.heading}>{title}</Text>
            {accessory ? <View>{accessory}</View> : null}
        </View>
    );
}

/** A label/value row used for the per-subject hours and summary figures. */
export function StatRow({ label, value }: { label: string; value: string }): React.JSX.Element {
    return (
        <View style={styles.statRow}>
            <Text style={styles.statLabel} numberOfLines={1}>
                {label}
            </Text>
            <Text style={styles.statValue}>{value}</Text>
        </View>
    );
}

const STATUS_COLORS: Record<ChapterStatus, { bg: string; fg: string }> = {
    NOT_STARTED: { bg: '#f3f4f6', fg: '#6b7280' },
    IN_PROGRESS: { bg: '#dbeafe', fg: '#1d4ed8' },
    DONE: { bg: '#dcfce7', fg: '#15803d' },
    REVISED: { bg: '#ede9fe', fg: '#6d28d9' },
};

/** A colored pill showing a chapter's current lifecycle status. */
export function StatusBadge({ status }: { status: ChapterStatus }): React.JSX.Element {
    const t = useTranslation();
    const palette = STATUS_COLORS[status];
    return (
        <View style={[styles.badge, { backgroundColor: palette.bg }]}>
            <Text style={[styles.badgeText, { color: palette.fg }]}>
                {t(chapterStatusKey(status))}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        backgroundColor: '#ffffff',
    },
    headingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    heading: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111827',
    },
    statRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 6,
    },
    statLabel: {
        flex: 1,
        marginRight: 12,
        fontSize: 14,
        color: '#374151',
    },
    statValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        alignSelf: 'flex-start',
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '600',
    },
});
