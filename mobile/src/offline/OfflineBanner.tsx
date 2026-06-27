/**
 * Offline indicator banner (task 21.9; Req 21.2, 21.6).
 *
 * A small, reusable strip any screen can render to signal the device is offline. When the
 * connectivity monitor reports `offline` it shows a short "You're offline" message plus the
 * number of queued Local_Sync_Records still waiting to sync (Req 21.3/21.4); an optional
 * `note` lets a screen append context (e.g. that a specific feature is unavailable offline,
 * Req 21.6). It renders nothing while online, so screens can mount it unconditionally.
 *
 * Strings are inlined English literals: this task must not edit the shared localization catalog
 * (owned by task 21.8). They can be promoted to catalog keys when that wiring lands.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useOffline } from './OfflineContext';

interface OfflineBannerProps {
    /** Optional extra line shown under the offline message (e.g. a feature-unavailable note). */
    note?: string;
}

export function OfflineBanner({ note }: OfflineBannerProps): React.JSX.Element | null {
    const { isOffline, outbox } = useOffline();

    if (!isOffline) {
        return null;
    }

    const queued = outbox.length;
    const queuedLabel =
        queued === 0
            ? 'All work is synced.'
            : `${queued} item${queued === 1 ? '' : 's'} queued to sync when you reconnect.`;

    return (
        <View style={styles.banner} accessibilityRole="alert">
            <Text style={styles.title}>You're offline</Text>
            <Text style={styles.detail}>{queuedLabel}</Text>
            {note ? <Text style={styles.detail}>{note}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        backgroundColor: '#fef3c7',
        borderColor: '#f59e0b',
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginBottom: 12,
    },
    title: {
        fontSize: 14,
        fontWeight: '700',
        color: '#92400e',
    },
    detail: {
        fontSize: 13,
        color: '#92400e',
        marginTop: 2,
    },
});
