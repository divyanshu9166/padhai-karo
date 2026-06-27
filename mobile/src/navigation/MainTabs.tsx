/**
 * Main app navigator (task 21.1). Presented to authenticated + onboarded users. Bottom tabs
 * map to the Phase 1 feature surfaces; Practice and Notes are nested stacks (tasks 21.6/21.7),
 * the others are single screens (tasks 21.3/21.4/21.5/21.8).
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';

import { DashboardScreen, FocusTimerScreen, NtaFeedScreen, TimetableScreen } from '@/screens';

import { NotesStack } from './NotesStack';
import { PracticeStack } from './PracticeStack';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs(): React.JSX.Element {
    return (
        <Tab.Navigator initialRouteName="Dashboard">
            <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Progress' }} />
            <Tab.Screen name="Timetable" component={TimetableScreen} options={{ title: 'Timetable' }} />
            <Tab.Screen name="Focus" component={FocusTimerScreen} options={{ title: 'Focus' }} />
            <Tab.Screen
                name="Practice"
                component={PracticeStack}
                options={{ title: 'Practice', headerShown: false }}
            />
            <Tab.Screen
                name="Notes"
                component={NotesStack}
                options={{ title: 'AI notes', headerShown: false }}
            />
            <Tab.Screen name="Nta" component={NtaFeedScreen} options={{ title: 'NTA' }} />
        </Tab.Navigator>
    );
}
