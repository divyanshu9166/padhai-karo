/**
 * App root (task 21.1).
 *
 * Composes the provider stack and mounts the onboarding-gated navigator:
 *
 *   SafeAreaProvider                  — safe-area insets for the navigators.
 *     └ AuthProvider                  — session/token state; drives the routing gate (Req 2.6).
 *         └ AppLocalizationProvider   — resolves UI strings by the stored Language_Preference,
 *                                       overriding the device locale, with a persisting toggle
 *                                       (Req 10.1/10.2/10.3); wraps the pure LocalizationProvider.
 *             └ OfflineProvider       — connectivity, downloads, and sync outbox (Req 21).
 *                 └ RootNavigator     — auth / onboarding / main-app branch selection.
 *
 * AppLocalizationProvider sits under AuthProvider because it reads the session status to load
 * the stored preference and persist changes (task 21.8, design "Localization").
 */
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppLocalizationProvider } from '@/localization';
import { RootNavigator } from '@/navigation';
import { OfflineProvider } from '@/offline';
import { AuthProvider } from '@/state';

export default function App(): React.JSX.Element {
    return (
        <SafeAreaProvider>
            <AuthProvider>
                <AppLocalizationProvider>
                    <OfflineProvider>
                        <StatusBar style="auto" />
                        <RootNavigator />
                    </OfflineProvider>
                </AppLocalizationProvider>
            </AuthProvider>
        </SafeAreaProvider>
    );
}
