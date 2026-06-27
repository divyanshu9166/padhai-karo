/**
 * Onboarding navigator (task 21.1, Req 2.6). Presented to authenticated users who have not
 * completed onboarding, before the main app.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { OnboardingScreen } from '@/screens';

import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingStack(): React.JSX.Element {
    return (
        <Stack.Navigator>
            <Stack.Screen
                name="Onboarding"
                component={OnboardingScreen}
                options={{ title: 'Set up your plan' }}
            />
        </Stack.Navigator>
    );
}
