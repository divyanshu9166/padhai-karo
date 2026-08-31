import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { AnalyticsScreen, CommunityScreen, CurrentAffairsScreen, LibraryScreen, StudyToolsScreen } from '@/screens';

import { NotesStack } from './NotesStack';
import type { MoreStackParamList } from './types';
import { MoreMenuScreen } from './MoreMenuScreen';

const Stack = createNativeStackNavigator<MoreStackParamList>();

/** Secondary surfaces live in one stack so the bottom navigation stays readable on phones. */
export function MoreStack(): React.JSX.Element {
    return (
        <Stack.Navigator>
            <Stack.Screen name="More" component={MoreMenuScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Notes" component={NotesStack} options={{ headerShown: false }} />
            <Stack.Screen name="Updates" component={CurrentAffairsScreen} />
            <Stack.Screen name="Tools" component={StudyToolsScreen} />
            <Stack.Screen name="Library" component={LibraryScreen} />
            <Stack.Screen name="Community" component={CommunityScreen} />
            <Stack.Screen name="Analytics" component={AnalyticsScreen} />
        </Stack.Navigator>
    );
}
