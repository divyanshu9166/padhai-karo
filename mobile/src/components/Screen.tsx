/**
 * Screen layout helper (task 21.1).
 *
 * A minimal safe-area-aware container used by the placeholder screens so the stubs render
 * consistently. Feature screens (21.2–21.9) can keep using it or replace as needed.
 */

import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScreenProps {
    title?: string;
    children?: ReactNode;
}

export function Screen({ title, children }: ScreenProps): React.JSX.Element {
    const insets = useSafeAreaInsets();
    return (
        <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom }]}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <View style={styles.body}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 20,
        backgroundColor: '#ffffff',
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        marginBottom: 12,
        color: '#111827',
    },
    body: {
        flex: 1,
    },
});
