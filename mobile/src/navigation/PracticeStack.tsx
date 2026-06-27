/**
 * Practice navigator (task 21.1) — PYQ practice, Timed Paper mode, and Mistake journal,
 * grouped under the Practice tab. Fleshed out by task 21.6.
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MistakeJournalScreen, PyqScreen, TimedPaperScreen } from '@/screens';
import type { PracticeStackParamList } from './types';

const Stack = createNativeStackNavigator<PracticeStackParamList>();

export function PracticeStack(): React.JSX.Element {
    return (
        <Stack.Navigator initialRouteName="Pyq">
            <Stack.Screen name="Pyq" component={PyqScreen} options={{ title: 'PYQs' }} />
            <Stack.Screen
                name="TimedPaper"
                component={TimedPaperScreen}
                options={{ title: 'Timed paper' }}
            />
            <Stack.Screen
                name="MistakeJournal"
                component={MistakeJournalScreen}
                options={{ title: 'Mistake journal' }}
            />
        </Stack.Navigator>
    );
}
