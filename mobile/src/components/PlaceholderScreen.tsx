/**
 * Reusable placeholder screen (task 21.1).
 *
 * A minimal localized stub built on {@link Screen}. Retained for any not-yet-implemented route;
 * the `titleKey` is a localization catalog key so stubs are already bilingual.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { useTranslation } from '@/localization';

import { Screen } from './Screen';

interface PlaceholderScreenProps {
    /** Localization catalog key for the screen title (e.g. 'dashboard.title'). */
    titleKey: string;
    /** Short note describing which task will implement this screen. */
    note?: string;
}

export function PlaceholderScreen({ titleKey, note }: PlaceholderScreenProps): React.JSX.Element {
    const t = useTranslation();
    return (
        <Screen title={t(titleKey)}>
            {note ? <Text style={styles.note}>{note}</Text> : null}
        </Screen>
    );
}

const styles = StyleSheet.create({
    note: { fontSize: 13, color: '#6b7280' },
});
