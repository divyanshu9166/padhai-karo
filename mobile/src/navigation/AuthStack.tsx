/**
 * Auth navigator (task 21.1). Presented to unauthenticated users: login, register (task 21.2),
 * and the emailed-code password reset.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { ForgotPasswordScreen, LoginScreen, RegisterScreen } from '@/screens';
import { useTranslation } from '@/localization';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack(): React.JSX.Element {
    const t = useTranslation();
    return (
        <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: t('auth.login') }} />
            <Stack.Screen
                name="Register"
                component={RegisterScreen}
                options={{ title: t('auth.register') }}
            />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: t('nav.resetPassword') }} />
        </Stack.Navigator>
    );
}
