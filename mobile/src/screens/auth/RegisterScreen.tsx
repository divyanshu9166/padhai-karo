/**
 * Register screen (task 21.2; Req 1.1).
 *
 * Wraps the shared {@link AuthForm}: submits credentials to `POST /auth/register`, then hands
 * the issued token + user to AuthContext.signIn. A new account has no profile, so `/auth/me`
 * reports `profileComplete: false` and the RootNavigator routes into onboarding (Req 2.6).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';

import { registerUser } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import type { AuthStackParamList } from '@/navigation/types';
import { useAuth } from '@/state';

import { AuthForm } from './AuthForm';

export function RegisterScreen({
    navigation,
}: NativeStackScreenProps<AuthStackParamList, 'Register'>): React.JSX.Element {
    const { signIn } = useAuth();
    const t = useTranslation();

    const handleSubmit = async (email: string, password: string): Promise<void> => {
        const { token, user } = await registerUser({ email, password });
        await signIn(token, user);
    };

    return (
        <Screen title={t('onboarding.title')}>
            <AuthForm
                submitLabel={t('auth.register')}
                onSubmit={handleSubmit}
                switchLabel={t('auth.haveAccount')}
                onSwitch={() => navigation.navigate('Login')}
            />
        </Screen>
    );
}
