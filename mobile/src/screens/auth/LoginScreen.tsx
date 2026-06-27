/**
 * Login screen (task 21.2; Req 1.4).
 *
 * Wraps the shared {@link AuthForm}: submits credentials to `POST /auth/login`, then hands the
 * issued token + user to AuthContext.signIn, which validates the session via `/auth/me` and
 * lets the RootNavigator advance (to onboarding or the main app per Req 2.6).
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';

import { loginUser } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import type { AuthStackParamList } from '@/navigation/types';
import { useAuth } from '@/state';

import { AuthForm } from './AuthForm';

export function LoginScreen({
    navigation,
}: NativeStackScreenProps<AuthStackParamList, 'Login'>): React.JSX.Element {
    const { signIn } = useAuth();
    const t = useTranslation();

    const handleSubmit = async (email: string, password: string): Promise<void> => {
        const { token, user } = await loginUser({ email, password });
        await signIn(token, user);
    };

    return (
        <Screen title={t('onboarding.title')}>
            <AuthForm
                submitLabel={t('auth.login')}
                onSubmit={handleSubmit}
                switchLabel={t('auth.needAccount')}
                onSwitch={() => navigation.navigate('Register')}
            />
        </Screen>
    );
}
