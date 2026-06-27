/**
 * Notes navigator (task 21.1) — AI notes summarizer and the subscription/paywall flow,
 * grouped under the Notes tab. Fleshed out by task 21.7.
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AiNotesScreen, PaywallScreen } from '@/screens';
import type { NotesStackParamList } from './types';

const Stack = createNativeStackNavigator<NotesStackParamList>();

export function NotesStack(): React.JSX.Element {
    return (
        <Stack.Navigator initialRouteName="AiNotes">
            <Stack.Screen name="AiNotes" component={AiNotesScreen} options={{ title: 'AI notes' }} />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ title: 'Upgrade' }} />
        </Stack.Navigator>
    );
}
