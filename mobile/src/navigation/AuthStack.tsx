/**
 * Auth navigator (task 21.1). Presented to unauthenticated users: login + register (task 21.2).
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { LoginScreen, RegisterScreen } from '@/screens';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack(): React.JSX.Element {
    return (
        <Stack.Navigator initialRouteName="Login">
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Log in' }} />
            <Stack.Screen
                name="Register"
                component={RegisterScreen}
                options={{ title: 'Create account' }}
            />
        </Stack.Navigator>
    );
}
