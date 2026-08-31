import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerPushDevice } from '@/api/upscProduct';
import { useAuth } from '@/state';

Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export function PushRegistration(): React.JSX.Element | null {
    const { status } = useAuth();
    useEffect(() => {
        if (status !== 'authenticated') return;
        void (async () => {
            if (Platform.OS === 'android') {
                await Notifications.setNotificationChannelAsync('study-reminders', {
                    name: 'Study reminders',
                    importance: Notifications.AndroidImportance.DEFAULT,
                    sound: 'default',
                });
            }
            const permissions = await Notifications.getPermissionsAsync();
            const granted = permissions.granted || (await Notifications.requestPermissionsAsync()).granted;
            if (!granted) return;
            const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
            const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
            await registerPushDevice(token.data, Platform.OS);
        })().catch(() => undefined);
    }, [status]);
    return null;
}
