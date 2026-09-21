import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { PlannerScreen, TimetableScreen } from '@/screens';

import type { PlanStackParamList } from './types';

const Stack = createNativeStackNavigator<PlanStackParamList>();

/** Advanced calendar stays available without competing with Today as a primary destination. */
export function PlanStack(): React.JSX.Element {
    return <Stack.Navigator>
        <Stack.Screen name="Plan" component={PlannerScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Timetable" component={TimetableScreen} options={{ title: 'Weekly calendar' }} />
    </Stack.Navigator>;
}
