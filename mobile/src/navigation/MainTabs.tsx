/**
 * Main app navigator (task 21.1). Presented to authenticated + onboarded users. Bottom tabs
 * map to the Phase 1 feature surfaces; Practice and Notes are nested stacks (tasks 21.6/21.7),
 * the others are single screens (tasks 21.3/21.4/21.5/21.8).
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';

import { DashboardScreen, FocusTimerScreen, PlannerScreen, TimetableScreen } from '@/screens';

import { MoreStack } from './MoreStack';
import { PracticeStack } from './PracticeStack';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs(): React.JSX.Element {
    return (
        <Tab.Navigator initialRouteName="Dashboard" screenOptions={{ headerShown: false }}>
            <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Progress' }} />
            <Tab.Screen name="Plan" component={PlannerScreen} options={{ title: 'Plan' }} />
            <Tab.Screen name="Timetable" component={TimetableScreen} options={{ title: 'Timetable' }} />
            <Tab.Screen name="Focus" component={FocusTimerScreen} options={{ title: 'Focus' }} />
            <Tab.Screen
                name="Practice"
                component={PracticeStack}
                options={{ title: 'Practice', headerShown: false }}
            />
            <Tab.Screen name="More" component={MoreStack} options={{ title: 'More' }} />
        </Tab.Navigator>
    );
}
