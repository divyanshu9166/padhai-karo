/**
 * Language toggle (task 21.8; Req 10.1/10.2/10.4).
 *
 * A compact EN/HI switch that reads the active Language_Preference and switches it via the
 * localization context's `setLanguage`. Selecting a language applies it immediately app-wide
 * (Req 10.2) and persists it to the User profile (Req 10.1, handled by
 * {@link AppLocalizationProvider}). EN and HI are the only options (Req 10.4).
 *
 * Each option is labelled in its own script (English / Hindi) so the control is recognizable
 * regardless of the currently active language — these are language *names*, not catalog strings.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from './LocalizationContext';
import type { Language } from './types';

const OPTIONS: ReadonlyArray<{ value: Language; label: string }> = [
    { value: 'EN', label: 'English' },
    { value: 'HI', label: 'हिन्दी' },
];

export function LanguageToggle(): React.JSX.Element {
    const { language, setLanguage } = useLocalization();

    return (
        <View style={styles.row} accessibilityRole="radiogroup">
            {OPTIONS.map((option) => {
                const active = option.value === language;
                return (
                    <Pressable
                        key={option.value}
                        onPress={() => setLanguage(option.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[styles.option, active && styles.optionActive]}
                    >
                        <Text style={[styles.optionText, active && styles.optionTextActive]}>
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 999,
        overflow: 'hidden',
        marginBottom: 16,
    },
    option: {
        paddingVertical: 6,
        paddingHorizontal: 14,
        backgroundColor: '#ffffff',
    },
    optionActive: {
        backgroundColor: '#2563eb',
    },
    optionText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#374151',
    },
    optionTextActive: {
        color: '#ffffff',
    },
});
