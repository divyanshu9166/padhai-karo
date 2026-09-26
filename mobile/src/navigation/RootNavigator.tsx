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
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '@/localization';
import { useAuth } from '@/state';

import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import { flushPendingNotificationRoute, navigationRef } from './navigationRef';
import { OnboardingStack } from './OnboardingStack';

function BootSplash(): React.JSX.Element {
    const t = useTranslation();
    return (
        <View style={styles.splash}>
            <View style={styles.mark}><Text style={styles.markText}>PK</Text></View>
            <Text style={styles.brand}>{t('boot.brand')}</Text>
            <Text style={styles.loading}>{t('boot.preparing')}</Text>
            <ActivityIndicator size="large" color="#2563eb" />
        </View>
    );
}

export function RootNavigator(): React.JSX.Element {
    const { status, profileComplete, sessionError, refresh, signOut } = useAuth();
    const t = useTranslation();

    let content: React.JSX.Element;
    if (status === 'loading') {
        content = <BootSplash />;
    } else if (status === 'unauthenticated') {
        content = <AuthStack />;
    } else if (status === 'session-unavailable') {
        content = (
            <View style={styles.splash}>
                <View style={styles.mark}><Text style={styles.markText}>PK</Text></View>
                <Text style={styles.brand}>{t('boot.brand')}</Text>
                <Text style={styles.error}>{sessionError ?? t('boot.sessionError')}</Text>
                <Pressable accessibilityRole="button" style={styles.retry} onPress={() => void refresh()}>
                    <Text style={styles.retryText}>{t('common.retry')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.signOut} onPress={() => void signOut()}>
                    <Text style={styles.signOutText}>{t('boot.signInAgain')}</Text>
                </Pressable>
            </View>
        );
    } else if (!profileComplete) {
        // Authenticated but not onboarded: gate the main app behind onboarding (Req 2.6).
        content = <OnboardingStack />;
    } else {
        content = <MainTabs />;
    }

    // The ref is typed for the main tabs; auth/onboarding stacks share the same container.
    return (
        <NavigationContainer ref={navigationRef as never} onReady={flushPendingNotificationRoute} onStateChange={flushPendingNotificationRoute}>
            {content}
        </NavigationContainer>
    );
}

const styles = StyleSheet.create({
    splash: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
    },
    mark: { width: 72, height: 72, borderRadius: 22, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
    markText: { color: '#fff', fontSize: 24, fontWeight: '900' },
    brand: { color: '#111827', fontSize: 26, fontWeight: '900', marginBottom: 8 },
    loading: { color: '#6b7280', marginBottom: 20 },
    error: { color: '#475569', textAlign: 'center', lineHeight: 22, maxWidth: 300, marginTop: 4 },
    retry: { backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, marginTop: 20 },
    retryText: { color: '#fff', fontWeight: '800' },
    signOut: { paddingHorizontal: 20, paddingVertical: 12, marginTop: 4 },
    signOutText: { color: '#1d4ed8', fontWeight: '700' },
});
