import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerPushDevice } from '@/api/upscProduct';
import { openNotificationRoute } from '@/navigation/navigationRef';
import { useAuth } from '@/state';

Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export function PushRegistration(): React.JSX.Element | null {
    const { status } = useAuth();

    // Open the screen a reminder points at (revision queue or daily quiz) when it is tapped,
    // including the tap that cold-started the app.
    useEffect(() => {
        void Notifications.getLastNotificationResponseAsync().then((response) => openNotificationRoute(response?.notification.request.content.data?.route)).catch(() => undefined);
        const subscription = Notifications.addNotificationResponseReceivedListener((response) => openNotificationRoute(response.notification.request.content.data?.route));
        return () => subscription.remove();
    }, []);

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
