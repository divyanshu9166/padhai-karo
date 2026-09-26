/**
 * Main app navigator (task 21.1). Presented to authenticated + onboarded users. Bottom tabs
 * map to the Phase 1 feature surfaces; Practice and Notes are nested stacks (tasks 21.6/21.7),
 * the others are single screens (tasks 21.3/21.4/21.5/21.8).
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';

import { FocusTimerScreen, TodayScreen } from '@/screens';
import { useTranslation } from '@/localization';

import { MoreStack } from './MoreStack';
import { PlanStack } from './PlanStack';
import { PracticeStack } from './PracticeStack';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs(): React.JSX.Element {
    const t = useTranslation();
    return (
        <Tab.Navigator initialRouteName="Dashboard" screenOptions={{ headerShown: false }}>
            <Tab.Screen name="Dashboard" component={TodayScreen} options={{ title: t('nav.today') }} />
            <Tab.Screen name="Plan" component={PlanStack} options={{ title: t('nav.plan'), headerShown: false }} />
            <Tab.Screen name="Focus" component={FocusTimerScreen} options={{ title: t('nav.focus') }} />
            <Tab.Screen
                name="Practice"
                component={PracticeStack}
                options={{ title: t('nav.practice'), headerShown: false }}
            />
            <Tab.Screen name="More" component={MoreStack} options={{ title: t('nav.more') }} />
        </Tab.Navigator>
    );
}
