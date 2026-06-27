/**
 * Root navigator — onboarding-gated routing (task 21.1, Req 2.6).
 *
 * Chooses which navigator to render from the auth/session state held by {@link useAuth}:
 *
 *   - `status === 'loading'`             → a boot splash while the stored token is validated.
 *   - `status === 'unauthenticated'`     → {@link AuthStack} (login / register).
 *   - authenticated + `!profileComplete` → {@link OnboardingStack} — onboarding is presented
 *                                          BEFORE the main app (Req 2.6).
 *   - authenticated + `profileComplete`  → {@link MainTabs} (the main app).
 *
 * Because the branches are mutually exclusive and state-driven, a sign-in, onboarding
 * completion, or sign-out re-renders straight into the correct flow with no imperative
 * navigation.
 */
import { NavigationContainer } from '@react-navigation/native';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/state';

import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { OnboardingStack } from './OnboardingStack';

function BootSplash(): React.JSX.Element {
    return (
        <View style={styles.splash}>
            <ActivityIndicator size="large" color="#2563eb" />
        </View>
    );
}

export function RootNavigator(): React.JSX.Element {
    const { status, profileComplete } = useAuth();

    let content: React.JSX.Element;
    if (status === 'loading') {
        content = <BootSplash />;
    } else if (status === 'unauthenticated') {
        content = <AuthStack />;
    } else if (!profileComplete) {
        // Authenticated but not onboarded: gate the main app behind onboarding (Req 2.6).
        content = <OnboardingStack />;
    } else {
        content = <MainTabs />;
    }

    return <NavigationContainer>{content}</NavigationContainer>;
}

const styles = StyleSheet.create({
    splash: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
